import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { Button } from '../../atoms/button/button.js';
import {
  Combobox,
  type ComboboxOption,
  type ComboboxSource,
} from '../../atoms/combobox/combobox.js';
import { Select, type SelectOption } from '../../atoms/select/select.js';
import { Toggle } from '../../atoms/toggle/toggle.js';
import {
  DateRangePicker,
  type DateRange,
} from '../../molecules/date-range-picker/date-range-picker.js';

export type MultiplierKind =
  | 'PREMIUM_DEFAULT'
  | 'COURSE_PROMO'
  | 'LESSON_PROMO'
  | 'STREAK_TIER'
  | 'CAMPAIGN';
export type MultiplierTarget = 'XP' | 'COINS' | 'BOTH';
export type MultiplierScope = 'global' | 'course' | 'lesson';

/** Shape of `CreateMultiplierBody` (api-client gamification.client). */
export interface MultiplierDraft {
  kind: MultiplierKind;
  target: MultiplierTarget;
  value: number;
  /** ISO datetime or null (open-ended). */
  startsAt: string | null;
  endsAt: string | null;
  courseId: string | null;
  lessonId: string | null;
  streakDaysMin: number | null;
  description: string | null;
  isActive: boolean;
}

export type MultiplierError =
  | 'valueRange'
  | 'scheduleOrder'
  | 'courseRequired'
  | 'lessonRequired'
  | 'streakDaysRequired';

export const MULTIPLIER_KINDS: readonly MultiplierKind[] = [
  'PREMIUM_DEFAULT',
  'COURSE_PROMO',
  'LESSON_PROMO',
  'STREAK_TIER',
  'CAMPAIGN',
];

/** Matches `DEFAULT_MULTIPLIER_CAP` in libs/domain. */
export const MULTIPLIER_MAX = 30;

const KIND_KEY: Record<MultiplierKind, string> = {
  PREMIUM_DEFAULT: 'gamification.multiplier.premium',
  COURSE_PROMO: 'gamification.multiplier.coursePromo',
  LESSON_PROMO: 'gamification.multiplier.lessonPromo',
  STREAK_TIER: 'gamification.multiplier.streakTier',
  CAMPAIGN: 'gamification.multiplier.campaign',
};

export function emptyMultiplier(): MultiplierDraft {
  return {
    kind: 'CAMPAIGN',
    target: 'BOTH',
    value: 2,
    startsAt: null,
    endsAt: null,
    courseId: null,
    lessonId: null,
    streakDaysMin: null,
    description: null,
    isActive: true,
  };
}

/** Scope implied by a draft's course / lesson ids. */
export function scopeOf(
  d: Pick<MultiplierDraft, 'courseId' | 'lessonId'>,
): MultiplierScope {
  if (d.lessonId) return 'lesson';
  if (d.courseId) return 'course';
  return 'global';
}

/** Pure validation (shared by the editor and its tests). */
export function validateMultiplier(
  d: MultiplierDraft,
  scope = scopeOf(d),
): MultiplierError[] {
  const errors: MultiplierError[] = [];
  if (!Number.isFinite(d.value) || d.value <= 0 || d.value > MULTIPLIER_MAX)
    errors.push('valueRange');
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt)
    errors.push('scheduleOrder');
  if (scope === 'course' && !d.courseId) errors.push('courseRequired');
  if (scope === 'lesson' && !d.lessonId) errors.push('lessonRequired');
  if (d.kind === 'STREAK_TIER' && !(d.streakDaysMin && d.streakDaysMin > 0)) {
    errors.push('streakDaysRequired');
  }
  return errors;
}

let editorSeq = 0;

/**
 * Form organism that builds one `Multiplier` row (docs/07 §3): kind, what
 * it boosts (XP / coins / both), the factor, scope (everything / a course /
 * a lesson), an optional schedule window and streak threshold. Emits the
 * draft on every change (`draftChange`) and on submit (`save`) when valid.
 *
 *   <cdf-multiplier-editor [value]="row" [courseOptions]="courses" (save)="persist($event)" />
 */
@Component({
  selector: 'cdf-multiplier-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    Combobox,
    Select,
    Toggle,
    DateRangePicker,
    TranslatePipe,
  ],
  template: `
    <form class="cdf-mult" (ngSubmit)="submit()" novalidate>
      <div class="cdf-mult__row">
        <div class="cdf-mult__field">
          <label class="cdf-mult__label" [for]="id + '-kind'">{{
            'ui.multiplier.kind' | translate
          }}</label>
          <cdf-select
            name="kind"
            [inputId]="id + '-kind'"
            [options]="kindOptions()"
            [ngModel]="draft().kind"
            (ngModelChange)="patch({ kind: $event })"
          />
        </div>
        <div class="cdf-mult__field">
          <label class="cdf-mult__label" [for]="id + '-target'">{{
            'ui.multiplier.target' | translate
          }}</label>
          <cdf-select
            name="target"
            [inputId]="id + '-target'"
            [options]="targetOptions()"
            [ngModel]="draft().target"
            (ngModelChange)="patch({ target: $event })"
          />
        </div>
        <div class="cdf-mult__field cdf-mult__field--narrow">
          <label class="cdf-mult__label" [for]="id + '-value'">{{
            'ui.multiplier.value' | translate
          }}</label>
          <div class="cdf-mult__value">
            <span aria-hidden="true">×</span>
            <input
              class="cdf-mult__input"
              type="number"
              inputmode="decimal"
              step="0.1"
              min="0.1"
              [max]="max"
              [id]="id + '-value'"
              [value]="draft().value"
              [attr.aria-invalid]="has('valueRange') || null"
              [attr.aria-describedby]="
                has('valueRange') ? id + '-value-error' : null
              "
              (input)="patch({ value: +$any($event.target).value })"
            />
          </div>
          @if (showErrors() && has('valueRange')) {
            <p class="cdf-mult__error" [id]="id + '-value-error'">
              {{ 'ui.multiplier.errors.valueRange' | translate: { max: max } }}
            </p>
          }
        </div>
      </div>

      <fieldset class="cdf-mult__scope">
        <legend class="cdf-mult__label">
          {{ 'ui.multiplier.scope' | translate }}
        </legend>
        @for (s of scopes; track s) {
          <label class="cdf-mult__radio">
            <input
              type="radio"
              [name]="id + '-scope'"
              [value]="s"
              [checked]="scope() === s"
              (change)="setScope(s)"
            />
            {{ 'ui.multiplier.scopes.' + s | translate }}
          </label>
        }
      </fieldset>

      @if (scope() === 'course' || scope() === 'lesson') {
        <div class="cdf-mult__field">
          <label class="cdf-mult__label" [for]="id + '-course'">{{
            'ui.multiplier.course' | translate
          }}</label>
          <cdf-combobox
            name="course"
            [inputId]="id + '-course'"
            [options]="courseOptions()"
            [source]="courseSource()"
            [invalid]="showErrors() && has('courseRequired')"
            [ngModel]="draft().courseId"
            (ngModelChange)="patch({ courseId: $event, lessonId: null })"
          />
          @if (showErrors() && has('courseRequired')) {
            <p class="cdf-mult__error">
              {{ 'ui.multiplier.errors.courseRequired' | translate }}
            </p>
          }
        </div>
      }
      @if (scope() === 'lesson') {
        <div class="cdf-mult__field">
          <label class="cdf-mult__label" [for]="id + '-lesson'">{{
            'ui.multiplier.lesson' | translate
          }}</label>
          <cdf-combobox
            name="lesson"
            [inputId]="id + '-lesson'"
            [options]="lessonOptions()"
            [source]="lessonSource()"
            [invalid]="showErrors() && has('lessonRequired')"
            [ngModel]="draft().lessonId"
            (ngModelChange)="patch({ lessonId: $event })"
          />
          @if (showErrors() && has('lessonRequired')) {
            <p class="cdf-mult__error">
              {{ 'ui.multiplier.errors.lessonRequired' | translate }}
            </p>
          }
        </div>
      }

      @if (draft().kind === 'STREAK_TIER') {
        <div class="cdf-mult__field cdf-mult__field--narrow">
          <label class="cdf-mult__label" [for]="id + '-streak'">{{
            'ui.multiplier.streakDaysMin' | translate
          }}</label>
          <input
            class="cdf-mult__input"
            type="number"
            min="1"
            step="1"
            [id]="id + '-streak'"
            [value]="draft().streakDaysMin ?? ''"
            [attr.aria-invalid]="has('streakDaysRequired') || null"
            (input)="patch({ streakDaysMin: toInt($any($event.target).value) })"
          />
          @if (showErrors() && has('streakDaysRequired')) {
            <p class="cdf-mult__error">
              {{ 'ui.multiplier.errors.streakDaysRequired' | translate }}
            </p>
          }
        </div>
      }

      <cdf-date-range-picker
        name="schedule"
        [withTime]="true"
        [legend]="'ui.multiplier.schedule' | translate"
        [ngModel]="schedule()"
        (ngModelChange)="setSchedule($event)"
      />
      <p class="cdf-mult__hint">
        {{ 'ui.multiplier.scheduleHint' | translate }}
      </p>

      <div class="cdf-mult__field">
        <label class="cdf-mult__label" [for]="id + '-desc'">{{
          'ui.multiplier.description' | translate
        }}</label>
        <input
          class="cdf-mult__input"
          type="text"
          maxlength="200"
          [id]="id + '-desc'"
          [value]="draft().description ?? ''"
          (input)="patch({ description: $any($event.target).value || null })"
        />
      </div>

      <cdf-toggle
        name="active"
        [label]="'ui.multiplier.active' | translate"
        [ngModel]="draft().isActive"
        (ngModelChange)="patch({ isActive: $event })"
      />

      <p class="cdf-mult__summary" aria-live="polite">{{ summary() }}</p>

      <div class="cdf-mult__actions">
        <cdf-button kind="ghost" (click)="cancelled.emit()">{{
          'common.cancel' | translate
        }}</cdf-button>
        <cdf-button kind="primary" type="submit" [loading]="saving()">{{
          'common.save' | translate
        }}</cdf-button>
      </div>
    </form>
  `,
  styleUrl: './multiplier-editor.scss',
})
export class MultiplierEditor {
  private readonly i18n = inject(I18nService);

  /** Initial / externally-updated draft. */
  readonly value = input<MultiplierDraft | null>(null);
  readonly courseOptions = input<ComboboxOption<string>[]>([]);
  readonly lessonOptions = input<ComboboxOption<string>[]>([]);
  readonly courseSource = input<ComboboxSource<string> | null>(null);
  readonly lessonSource = input<ComboboxSource<string> | null>(null);
  readonly saving = input(false);

  readonly draftChange = output<MultiplierDraft>();
  readonly save = output<MultiplierDraft>();
  readonly cancelled = output<void>();

  protected readonly id = `cdf-mult-${++editorSeq}`;
  protected readonly max = MULTIPLIER_MAX;
  protected readonly scopes: readonly MultiplierScope[] = [
    'global',
    'course',
    'lesson',
  ];
  protected readonly draft = signal<MultiplierDraft>(emptyMultiplier());
  protected readonly scope = signal<MultiplierScope>('global');
  protected readonly showErrors = signal(false);

  protected readonly errors = computed(() =>
    validateMultiplier(this.draft(), this.scope()),
  );
  protected readonly schedule = computed<DateRange>(() => ({
    start: this.draft().startsAt,
    end: this.draft().endsAt,
  }));
  protected readonly kindOptions = computed<SelectOption<MultiplierKind>[]>(
    () => {
      this.i18n.currentLocale();
      return MULTIPLIER_KINDS.map((k) => ({
        value: k,
        label: this.i18n.t(KIND_KEY[k]),
      }));
    },
  );
  protected readonly targetOptions = computed<SelectOption<MultiplierTarget>[]>(
    () => {
      this.i18n.currentLocale();
      return (['BOTH', 'XP', 'COINS'] as const).map((t) => ({
        value: t,
        label: this.i18n.t(`ui.multiplier.targets.${t}`),
      }));
    },
  );
  protected readonly summary = computed(() => {
    this.i18n.currentLocale();
    const d = this.draft();
    return this.i18n.t('ui.multiplier.summary', {
      value: d.value,
      target: this.i18n.t(`ui.multiplier.targets.${d.target}`),
      scope: this.i18n.t(`ui.multiplier.scopes.${this.scope()}`),
    });
  });

  constructor() {
    effect(() => {
      const v = this.value();
      untracked(() => {
        const next = v ? { ...emptyMultiplier(), ...v } : emptyMultiplier();
        this.draft.set(next);
        this.scope.set(scopeOf(next));
        this.showErrors.set(false);
      });
    });
  }

  protected has(e: MultiplierError): boolean {
    return this.errors().includes(e);
  }

  protected toInt(raw: string): number | null {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  protected patch(p: Partial<MultiplierDraft>): void {
    const next = { ...this.draft(), ...p };
    // Lesson promos are lesson-scoped by definition (and course promos course-scoped).
    if (p.kind === 'LESSON_PROMO') this.scope.set('lesson');
    if (p.kind === 'COURSE_PROMO' && this.scope() === 'global')
      this.scope.set('course');
    this.draft.set(next);
    this.draftChange.emit(next);
  }

  protected setScope(s: MultiplierScope): void {
    this.scope.set(s);
    if (s === 'global') this.patch({ courseId: null, lessonId: null });
    else if (s === 'course') this.patch({ lessonId: null });
  }

  protected setSchedule(r: DateRange): void {
    this.patch({ startsAt: r.start, endsAt: r.end });
  }

  protected submit(): void {
    this.showErrors.set(true);
    if (this.errors().length === 0) this.save.emit(this.draft());
  }
}
