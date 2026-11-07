import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Icon, IconButton, Kbd, Spinner } from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  type AdminSearchHit,
  type AdminSearchHitType,
  type AdminSearchResults,
} from '@codify/api-client';
import { AdminErrors } from './errors';

export const SEARCH_DEBOUNCE_MS = 200;
export const SEARCH_MIN_CHARS = 2;

/** Result groups in display order. */
export const SEARCH_GROUPS: readonly {
  key: keyof Omit<AdminSearchResults, 'q'>;
  type: AdminSearchHitType;
}[] = [
  { key: 'courses', type: 'course' },
  { key: 'lessons', type: 'lesson' },
  { key: 'users', type: 'user' },
  { key: 'items', type: 'item' },
  { key: 'badges', type: 'badge' },
];

export interface SearchGroup {
  type: AdminSearchHitType;
  hits: { hit: AdminSearchHit; index: number }[];
}

/** Non-empty groups with a running index for keyboard navigation. */
export function groupResults(r: AdminSearchResults | null): SearchGroup[] {
  if (!r) return [];
  let index = 0;
  return SEARCH_GROUPS.map((g) => ({
    type: g.type,
    hits: r[g.key].map((hit) => ({ hit, index: index++ })),
  })).filter((g) => g.hits.length > 0);
}

/** Where a hit opens in the admin app. */
export function hitLink(hit: AdminSearchHit): {
  commands: string[];
  queryParams?: Record<string, string>;
} {
  switch (hit.type) {
    case 'course':
      return { commands: ['/courses', hit.subtitle ?? hit.id] };
    case 'lesson':
      return { commands: ['/lessons', hit.id] };
    case 'user':
      return { commands: ['/users', hit.id] };
    case 'item':
      return { commands: ['/items'] };
    case 'badge':
      return { commands: ['/gamification'], queryParams: { tab: 'badges' } };
  }
}

/** Arrow-key movement over `count` options, wrapping at both ends. */
export function moveActive(
  current: number,
  delta: number,
  count: number,
): number {
  if (count === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Global search palette (docs/04 §6): a modal dialog opened with
 * Cmd/Ctrl-K or the top-bar button. The input is a combobox over a
 * grouped listbox — ↑/↓ move, Enter opens, Esc closes, Tab cycles
 * between the input and the close button; focus returns to where it was.
 */
@Component({
  selector: 'cdf-admin-search-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, IconButton, Kbd, Spinner, TranslatePipe],
  template: `
    @if (open()) {
      <div
        class="palette-backdrop"
        aria-hidden="true"
        (pointerdown)="close()"
      ></div>
      <div
        #dialog
        class="palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        (keydown)="onKeydown($event)"
      >
        <h2 id="palette-title" class="visually-hidden">
          {{ 'admin.search.title' | translate }}
        </h2>
        <div class="palette__bar">
          <cdf-icon name="search" />
          <input
            #input
            type="text"
            class="palette__input"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-autocomplete="list"
            aria-controls="palette-results"
            [attr.aria-expanded]="groups().length > 0"
            [attr.aria-activedescendant]="
              active() >= 0 ? 'palette-opt-' + active() : null
            "
            [attr.aria-label]="'admin.search.label' | translate"
            [placeholder]="'admin.search.placeholder' | translate"
            [value]="query()"
            (input)="onInput($any($event.target).value)"
          />
          @if (loading()) {
            <cdf-spinner size="sm" />
          }
          <cdf-icon-button
            #closeBtn
            icon="x"
            size="sm"
            [ariaLabel]="'admin.search.close' | translate"
            (click)="close()"
          />
        </div>
        <div
          id="palette-results"
          class="palette__results"
          role="listbox"
          [attr.aria-label]="'admin.search.results' | translate"
        >
          @for (g of groups(); track g.type) {
            <div role="group" [attr.aria-labelledby]="'palette-g-' + g.type">
              <div class="palette__group" [id]="'palette-g-' + g.type">
                {{ 'admin.search.groups.' + g.type | translate }}
              </div>
              @for (h of g.hits; track h.hit.id) {
                <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -- keyboard lives on the combobox input (aria-activedescendant) -->
                <div
                  class="palette__option"
                  role="option"
                  [id]="'palette-opt-' + h.index"
                  [attr.aria-selected]="active() === h.index"
                  [class.palette__option--active]="active() === h.index"
                  (pointerenter)="active.set(h.index)"
                  (click)="go(h.hit)"
                >
                  <span class="palette__title">{{ h.hit.title }}</span>
                  @if (h.hit.subtitle) {
                    <span class="palette__sub mono">{{ h.hit.subtitle }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
        <p class="palette__status small muted" aria-live="polite">
          @if (error(); as e) {
            <span class="palette__error">{{ e }}</span>
          } @else if (query().trim().length < minChars) {
            {{ 'admin.search.hint' | translate: { min: minChars } }}
          } @else if (!loading() && results() && flat().length === 0) {
            {{ 'admin.search.empty' | translate: { q: query().trim() } }}
          } @else if (flat().length > 0) {
            {{ 'admin.search.count' | translate: { count: flat().length } }}
          }
        </p>
        <p class="palette__keys small muted" aria-hidden="true">
          <cdf-kbd>↑</cdf-kbd><cdf-kbd>↓</cdf-kbd>
          {{ 'admin.search.keysMove' | translate }}
          <cdf-kbd>↵</cdf-kbd> {{ 'admin.search.keysOpen' | translate }}
          <cdf-kbd>{{ 'admin.search.keyEsc' | translate }}</cdf-kbd>
          {{ 'admin.search.keysClose' | translate }}
        </p>
      </div>
    }
  `,
  styles: [
    `
      .palette-backdrop {
        position: fixed;
        inset: 0;
        background: rgb(0 0 0 / 40%);
        z-index: 1080;
      }
      .palette {
        position: fixed;
        top: 10vh;
        left: 50%;
        transform: translateX(-50%);
        width: min(640px, calc(100vw - 24px));
        max-height: 75vh;
        display: flex;
        flex-direction: column;
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        box-shadow: 0 16px 48px rgb(0 0 0 / 25%);
        z-index: 1081;
      }
      .palette__bar {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .palette__input {
        flex: 1;
        border: 0;
        background: transparent;
        color: inherit;
        font-size: 1.05rem;
        padding: 6px 0;
      }
      .palette__input:focus {
        outline: none;
      }
      .palette__bar:focus-within {
        box-shadow: inset 0 -2px 0 var(--cdf-color-primary);
      }
      .palette__results {
        overflow-y: auto;
        padding: 4px 0;
      }
      .palette__group {
        padding: 8px var(--cdf-space-3) 2px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--cdf-color-text-muted);
      }
      .palette__option {
        display: flex;
        flex-direction: column;
        padding: 6px var(--cdf-space-3);
        cursor: pointer;
      }
      .palette__option--active {
        background: var(--cdf-color-primary-subtle, rgb(0 0 0 / 6%));
        box-shadow: inset 3px 0 0 var(--cdf-color-primary);
      }
      .palette__title {
        font-weight: 600;
      }
      .palette__sub {
        font-size: 12px;
        color: var(--cdf-color-text-muted);
      }
      .palette__status,
      .palette__keys {
        margin: 0;
        padding: 6px var(--cdf-space-3);
      }
      .palette__keys {
        border-top: 1px solid var(--cdf-color-border);
      }
      .palette__error {
        color: var(--cdf-color-danger);
      }
    `,
  ],
})
export class SearchPalette {
  private readonly client = inject(AdminOpsClient);
  private readonly router = inject(Router);
  private readonly errors = inject(AdminErrors);

  readonly open = input(false);
  readonly closed = output<void>();

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');
  private readonly dialogEl = viewChild<ElementRef<HTMLElement>>('dialog');

  protected readonly minChars = SEARCH_MIN_CHARS;
  protected readonly query = signal('');
  protected readonly results = signal<AdminSearchResults | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly active = signal(-1);
  protected readonly groups = computed(() => groupResults(this.results()));
  protected readonly flat = computed(() =>
    this.groups().flatMap((g) => g.hits.map((h) => h.hit)),
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.returnFocus =
          typeof document !== 'undefined'
            ? (document.activeElement as HTMLElement | null)
            : null;
        // Focus once the dialog has rendered.
        setTimeout(() => this.inputEl()?.nativeElement.focus());
      }
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.error.set(null);
    if (this.timer) clearTimeout(this.timer);
    const q = value.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      this.seq += 1;
      this.results.set(null);
      this.active.set(-1);
      this.loading.set(false);
      return;
    }
    this.timer = setTimeout(() => void this.run(q), SEARCH_DEBOUNCE_MS);
  }

  /** Latest-request-wins search. */
  private async run(q: string): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const res = await this.client.search(q);
      if (seq !== this.seq) return;
      this.results.set(res);
      this.active.set(groupResults(res).length > 0 ? 0 : -1);
    } catch (err) {
      if (seq !== this.seq) return;
      this.results.set(null);
      this.error.set(this.errors.message(err, 'admin.search.failed'));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const count = this.flat().length;
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        ev.preventDefault();
        this.active.set(
          moveActive(this.active(), ev.key === 'ArrowDown' ? 1 : -1, count),
        );
        this.scrollActiveIntoView();
        break;
      case 'Enter': {
        const hit = this.flat()[this.active()];
        if (hit) {
          ev.preventDefault();
          this.go(hit);
        }
        break;
      }
      case 'Escape':
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
        break;
      case 'Tab':
        this.trapTab(ev);
        break;
    }
  }

  /** Keep Tab inside the dialog (input ↔ close button). */
  private trapTab(ev: KeyboardEvent): void {
    const root = this.dialogEl()?.nativeElement;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('input, button'),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const i = focusables.indexOf(document.activeElement as HTMLElement);
    const next = ev.shiftKey
      ? (i - 1 + focusables.length) % focusables.length
      : (i + 1) % focusables.length;
    ev.preventDefault();
    focusables[next].focus();
  }

  private scrollActiveIntoView(): void {
    const id = `palette-opt-${this.active()}`;
    setTimeout(() =>
      document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  protected go(hit: AdminSearchHit): void {
    const link = hitLink(hit);
    this.close(false);
    void this.router.navigate(link.commands, {
      queryParams: link.queryParams,
    });
  }

  protected close(restoreFocus = true): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.query.set('');
    this.results.set(null);
    this.error.set(null);
    this.loading.set(false);
    this.active.set(-1);
    this.closed.emit();
    if (restoreFocus) {
      const target = this.returnFocus;
      setTimeout(() => target?.focus?.());
    }
  }
}
