import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Button,
  Checkbox,
  DateRangePicker,
  type DateRange,
  FormField,
  Input,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  type DropCopy,
  type Item,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { localToIso } from '../core/catalog';
import { stableStringify } from '../core/dirty';

type Step = 'items' | 'window' | 'copy';
const STEPS: readonly Step[] = ['items', 'window', 'copy'];
const LOCALES = ['pt-BR', 'en-US'] as const;
type CopyLocale = (typeof LOCALES)[number];

/** Default push copy per locale; `{item}` becomes the item name. */
export const DEFAULT_DROP_COPY: Record<CopyLocale, DropCopy> = {
  'pt-BR': {
    title: '✨ Novo item limitado: {item}',
    body: 'Disponível por tempo limitado na loja.',
  },
  'en-US': {
    title: '✨ Limited drop: {item}',
    body: 'In the shop for a limited time.',
  },
};

/** Validation for the wizard; returns `admin.items.drops.errors.*` keys. */
export function dropProblems(input: {
  itemIds: string[];
  start: string | null;
  end: string | null;
  copy: Record<CopyLocale, DropCopy>;
  now: Date;
}): string[] {
  const out: string[] = [];
  if (input.itemIds.length === 0) out.push('noItems');
  const s = input.start ? new Date(input.start).getTime() : NaN;
  const e = input.end ? new Date(input.end).getTime() : null;
  if (Number.isNaN(s)) out.push('noStart');
  if (e !== null && !Number.isNaN(s) && e <= s) out.push('endBeforeStart');
  if (e !== null && e <= input.now.getTime()) out.push('ended');
  for (const l of LOCALES)
    if (!input.copy[l].title.trim() || !input.copy[l].body.trim()) {
      out.push('copy');
      break;
    }
  return out;
}

/**
 * "Schedule limited drop" wizard (docs/04 Shop → Items): pick items, set
 * the drop window, write the ITEM_DROP push copy in both locales. On
 * submit the API puts the items on the window and the drop-announcement
 * job sends the push when it opens.
 */
@Component({
  selector: 'cdf-drop-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    Checkbox,
    DateRangePicker,
    FormField,
    Input,
    TranslatePipe,
  ],
  template: `
    <ol class="steps" [attr.aria-label]="'admin.items.drops.steps' | translate">
      @for (s of steps; track s; let i = $index) {
        <li
          [class.active]="step() === s"
          [attr.aria-current]="step() === s ? 'step' : null"
        >
          {{ i + 1 }}. {{ 'admin.items.drops.step.' + s | translate }}
        </li>
      }
    </ol>

    @switch (step()) {
      @case ('items') {
        <cdf-form-field
          [label]="'admin.items.drops.search' | translate"
          controlId="drop-search"
        >
          <cdf-input
            inputId="drop-search"
            [(ngModel)]="query"
            (ngModelChange)="q.set($event)"
          />
        </cdf-form-field>
        <p class="muted small" aria-live="polite">
          {{
            'admin.items.drops.selected' | translate: { count: selected().size }
          }}
        </p>
        <ul class="plain-list pick-list" data-testid="drop-items">
          @for (it of visible(); track it.id) {
            <li>
              <cdf-checkbox
                [ngModel]="selected().has(it.id)"
                (ngModelChange)="toggle(it.id, $event)"
                [label]="it.name + ' · ' + it.slug"
              />
            </li>
          } @empty {
            <li class="muted small">
              {{ 'admin.items.drops.noMatch' | translate }}
            </li>
          }
        </ul>
      }
      @case ('window') {
        <cdf-date-range-picker
          [withTime]="true"
          [legend]="'admin.items.dropWindow' | translate"
          [(ngModel)]="window"
        />
        <p class="muted small">
          {{ 'admin.items.drops.windowHelp' | translate }}
        </p>
      }
      @case ('copy') {
        <p class="muted small">
          {{ 'admin.items.drops.copyHelp' | translate }}
        </p>
        @for (l of locales; track l) {
          <fieldset class="group">
            <legend>{{ l }}</legend>
            <cdf-form-field
              [label]="'admin.items.drops.pushTitle' | translate"
              [controlId]="'drop-title-' + l"
            >
              <cdf-input
                [inputId]="'drop-title-' + l"
                [(ngModel)]="copy[l].title"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.items.drops.pushBody' | translate"
              [controlId]="'drop-body-' + l"
            >
              <cdf-input
                [inputId]="'drop-body-' + l"
                [(ngModel)]="copy[l].body"
              />
            </cdf-form-field>
          </fieldset>
        }
      }
    }

    @if (problems().length) {
      <ul class="issue-list" role="alert">
        @for (p of problems(); track p) {
          <li>{{ 'admin.items.drops.errors.' + p | translate }}</li>
        }
      </ul>
    }
    @if (error(); as e) {
      <p class="form-error" role="alert">{{ e }}</p>
    }

    <div class="form-actions">
      @if (stepIndex() > 0) {
        <cdf-button kind="secondary" [disabled]="saving()" (click)="go(-1)">
          {{ 'admin.courses.wizard.back' | translate }}
        </cdf-button>
      }
      @if (step() !== 'copy') {
        <cdf-button kind="primary" (click)="go(1)" data-testid="drop-next">
          {{ 'admin.courses.wizard.next' | translate }}
        </cdf-button>
      } @else {
        <cdf-button
          kind="primary"
          [loading]="saving()"
          (click)="submit()"
          data-testid="drop-submit"
        >
          {{ 'admin.items.drops.submit' | translate }}
        </cdf-button>
      }
      <cdf-button kind="ghost" [disabled]="saving()" (click)="cancelled.emit()">
        {{ 'admin.common.cancel' | translate }}
      </cdf-button>
    </div>
  `,
  styles: [
    `
      .steps {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-3);
        list-style: none;
        padding: 0;
        color: var(--cdf-color-text-muted);
        li.active {
          color: var(--cdf-color-text);
          font-weight: 600;
        }
      }
      .pick-list {
        max-height: 320px;
        overflow-y: auto;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-2);
      }
      .group {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
        legend {
          font-size: var(--cdf-font-size-sm);
          font-weight: 600;
          width: auto;
          float: none;
          padding: 0 4px;
        }
      }
    `,
  ],
})
export class DropWizard {
  private readonly client = inject(AdminCatalogClient);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  readonly items = input<Item[]>([]);
  readonly scheduled = output<void>();
  readonly cancelled = output<void>();

  protected readonly steps = STEPS;
  protected readonly locales = LOCALES;
  protected readonly step = signal<Step>('items');
  protected readonly stepIndex = computed(() => STEPS.indexOf(this.step()));
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly q = signal('');
  protected query = '';
  protected window: DateRange = { start: null, end: null };
  protected copy: Record<CopyLocale, DropCopy> = {
    'pt-BR': { ...DEFAULT_DROP_COPY['pt-BR'] },
    'en-US': { ...DEFAULT_DROP_COPY['en-US'] },
  };
  protected readonly problems = signal<string[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  private readonly initial = this.snapshot();

  protected readonly visible = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.items().filter(
      (it) =>
        !q ||
        it.name.toLowerCase().includes(q) ||
        it.slug.toLowerCase().includes(q),
    );
  });

  private snapshot(): string {
    return stableStringify({
      s: [...(this.selected?.() ?? [])],
      w: this.window,
      c: this.copy,
    });
  }

  hasUnsavedChanges(): boolean {
    return this.snapshot() !== this.initial;
  }

  protected toggle(id: string, on: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private stepProblems(step: Step): string[] {
    const all = dropProblems({
      itemIds: [...this.selected()],
      start: localToIso(this.window.start),
      end: localToIso(this.window.end),
      copy: this.copy,
      now: new Date(),
    });
    const of: Record<Step, string[]> = {
      items: ['noItems'],
      window: ['noStart', 'endBeforeStart', 'ended'],
      copy: ['copy'],
    };
    return all.filter((p) => of[step].includes(p));
  }

  protected go(dir: -1 | 1): void {
    if (dir === 1) {
      const p = this.stepProblems(this.step());
      this.problems.set(p);
      if (p.length) return;
    } else this.problems.set([]);
    this.step.set(STEPS[this.stepIndex() + dir]);
  }

  protected async submit(): Promise<void> {
    const start = localToIso(this.window.start);
    const end = localToIso(this.window.end);
    const p = dropProblems({
      itemIds: [...this.selected()],
      start,
      end,
      copy: this.copy,
      now: new Date(),
    });
    this.problems.set(p);
    if (p.length || !start) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const res = await this.client.scheduleDrop({
        itemIds: [...this.selected()],
        startsAt: start,
        endsAt: end,
        copy: this.copy,
      });
      this.toast.success(
        this.i18n.t('admin.items.drops.done', { count: res.itemIds.length }),
      );
      this.scheduled.emit();
    } catch (err) {
      this.error.set(this.errorsSvc.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}
