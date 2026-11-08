import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { SearchClient, type CatalogSearchResponse } from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

interface Option {
  id: string;
  kind: 'course' | 'lesson';
  title: string;
  context: string | null;
  url: string;
}

/** Debounce of the header search (ms). */
export const GLOBAL_SEARCH_DEBOUNCE_MS = 250;

let seq = 0;

/**
 * Desktop header search over courses and lessons (docs/05 §1). WAI-ARIA
 * combobox: type to search (debounced, server-side), ↑/↓ to move, Enter to
 * open, Esc to close. Online only — offline it says so.
 */
@Component({
  selector: 'cdf-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <div class="gs" (focusout)="onFocusOut($event)">
      <cdf-icon name="search" size="xs" class="gs__icon" />
      <input
        type="search"
        class="gs__input"
        role="combobox"
        autocomplete="off"
        data-testid="global-search"
        [id]="inputId"
        [attr.aria-label]="'studentPlatform.shell.searchLabel' | translate"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [placeholder]="
          (online()
            ? 'studentPlatform.shell.searchPlaceholder'
            : 'studentPlatform.shell.searchOffline'
          ) | translate
        "
        [disabled]="!online()"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKey($event)"
        (focus)="open.set(query().trim().length >= 2)"
      />
      @if (open()) {
        <ul
          class="gs__list"
          role="listbox"
          data-testid="global-search-results"
          [id]="listId"
          [attr.aria-label]="'studentPlatform.shell.searchResults' | translate"
        >
          @if (loading() && options().length === 0) {
            <li class="gs__empty" role="presentation">
              {{ 'studentPlatform.shell.searching' | translate }}
            </li>
          } @else if (options().length === 0) {
            <li class="gs__empty" role="presentation">
              {{ 'studentPlatform.shell.noResults' | translate }}
            </li>
          }
          @for (o of options(); track o.kind + o.id; let i = $index) {
            <li
              role="option"
              class="gs__opt"
              [id]="optionId(i)"
              [attr.aria-selected]="i === active()"
              [attr.data-kind]="o.kind"
              tabindex="-1"
              (mousedown)="$event.preventDefault()"
              (click)="choose(o)"
              (keydown.enter)="choose(o)"
            >
              <cdf-icon
                [name]="o.kind === 'course' ? 'school' : 'play'"
                size="xs"
              />
              <span class="gs__text">
                <span class="gs__title">{{ o.title }}</span>
                <span class="gs__ctx">{{
                  o.context ??
                    ('studentPlatform.shell.searchCourse' | translate)
                }}</span>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .gs {
        position: relative;
        display: flex;
        align-items: center;
      }
      .gs__icon {
        position: absolute;
        left: 10px;
        color: var(--cdf-color-text-muted);
        pointer-events: none;
      }
      .gs__input {
        width: 100%;
        min-height: 36px;
        padding: 0 10px 0 30px;
        border: 1px solid var(--cdf-color-border, #e5e7eb);
        border-radius: 999px;
        background: var(--cdf-color-surface, #fff);
        color: inherit;
        font: inherit;
        font-size: 14px;
      }
      .gs__input:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 1px;
      }
      .gs__list {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        min-width: 280px;
        max-height: 60vh;
        overflow: auto;
        margin: 0;
        padding: 6px;
        list-style: none;
        z-index: 40;
        background: var(--cdf-color-surface-elev, #fff);
        border: 1px solid var(--cdf-color-border, #e5e7eb);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }
      .gs__opt {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
      }
      .gs__opt[aria-selected='true'],
      .gs__opt:hover {
        background: var(--cdf-color-primary-subtle, #eef2ff);
      }
      .gs__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .gs__title {
        font-weight: 600;
        font-size: 14px;
      }
      .gs__ctx,
      .gs__empty {
        font-size: 12px;
        color: var(--cdf-color-text-muted);
      }
      .gs__empty {
        padding: 8px;
      }
    `,
  ],
})
export class GlobalSearch {
  private readonly client = inject(SearchClient);
  private readonly router = inject(Router);
  private readonly telemetry = inject(TelemetryService);
  protected readonly online = inject(NetworkStatusService).online;

  protected readonly inputId = `cdf-gs-${++seq}`;
  protected readonly listId = `${this.inputId}-list`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly active = signal(-1);
  private readonly result = signal<CatalogSearchResponse | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seqNo = 0;

  protected readonly options = computed<Option[]>(() => {
    const r = this.result();
    if (!r) return [];
    return [
      ...r.courses.map((c) => ({
        id: c.id,
        kind: 'course' as const,
        title: c.title,
        context: null,
        url: `/courses/${c.slug}`,
      })),
      ...r.lessons.map((l) => ({
        id: l.id,
        kind: 'lesson' as const,
        title: l.title,
        context: l.courseTitle,
        url: `/lessons/${l.id}`,
      })),
    ];
  });
  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? this.optionId(this.active()) : null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected optionId(i: number): string {
    return `${this.inputId}-opt-${i}`;
  }

  protected onInput(v: string): void {
    this.query.set(v);
    this.active.set(-1);
    if (this.timer) clearTimeout(this.timer);
    const q = v.trim();
    if (q.length < 2) {
      this.open.set(false);
      this.result.set(null);
      return;
    }
    this.open.set(true);
    this.timer = setTimeout(() => void this.run(q), GLOBAL_SEARCH_DEBOUNCE_MS);
  }

  private async run(q: string): Promise<void> {
    const n = ++this.seqNo;
    this.loading.set(true);
    try {
      const r = await this.client.search(q);
      if (n !== this.seqNo) return;
      this.result.set(r);
      this.telemetry.track('global_search', {
        courses: r.courses.length,
        lessons: r.lessons.length,
        length: q.length,
      });
    } catch {
      if (n === this.seqNo) this.result.set({ courses: [], lessons: [] });
    } finally {
      if (n === this.seqNo) this.loading.set(false);
    }
  }

  protected onKey(ev: KeyboardEvent): void {
    const n = this.options().length;
    if (ev.key === 'Escape') {
      this.open.set(false);
      return;
    }
    if (!this.open() || n === 0) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.active.set((this.active() + 1) % n);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.active.set((this.active() - 1 + n) % n);
    } else if (ev.key === 'Enter' && this.active() >= 0) {
      ev.preventDefault();
      this.choose(this.options()[this.active()]);
    }
  }

  protected choose(o: Option): void {
    this.open.set(false);
    this.query.set('');
    this.result.set(null);
    void this.router.navigateByUrl(o.url);
  }

  protected onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next))
      this.open.set(false);
  }
}
