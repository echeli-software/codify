import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';

/**
 * ISO strings: `YYYY-MM-DD` (date mode) or `YYYY-MM-DDTHH:mm` (datetime mode,
 * local wall time). `null` = open-ended on that side.
 */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface DateRangePreset {
  /** i18n key or literal label. */
  label: string;
  /** Days from today (0 = today) for start / end. */
  startOffsetDays: number;
  endOffsetDays: number;
}

let rangeSeq = 0;

/** `true` when both ends are set and end is before start. */
export function isInvertedRange(r: DateRange): boolean {
  return !!r.start && !!r.end && r.end < r.start;
}

/**
 * Start/end picker for promotion windows and multiplier schedules. Uses
 * native `date` / `datetime-local` inputs (keyboard + screen-reader support
 * and locale-aware formatting for free), each with a visible label, and
 * validates that the end is not before the start.
 *
 *   <cdf-date-range-picker [withTime]="true" [(ngModel)]="window" />
 */
@Component({
  selector: 'cdf-date-range-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <fieldset
      class="cdf-range"
      [attr.aria-describedby]="invalidRange() ? errorId : null"
    >
      @if (legend(); as l) {
        <legend class="cdf-range__legend">{{ l }}</legend>
      }
      <div class="cdf-range__fields">
        <div class="cdf-range__field">
          <label class="cdf-range__label" [for]="startId">{{
            startLabel() ?? ('ui.dateRange.start' | translate)
          }}</label>
          <input
            class="cdf-range__input"
            [type]="type()"
            [id]="startId"
            [value]="value().start ?? ''"
            [min]="min() ?? null"
            [max]="value().end ?? max() ?? null"
            [disabled]="disabled()"
            [attr.aria-invalid]="invalidRange() || null"
            (change)="set('start', $any($event.target).value)"
            (blur)="onTouched()"
          />
        </div>
        <span class="cdf-range__sep" aria-hidden="true">→</span>
        <div class="cdf-range__field">
          <label class="cdf-range__label" [for]="endId">{{
            endLabel() ?? ('ui.dateRange.end' | translate)
          }}</label>
          <input
            class="cdf-range__input"
            [type]="type()"
            [id]="endId"
            [value]="value().end ?? ''"
            [min]="value().start ?? min() ?? null"
            [max]="max() ?? null"
            [disabled]="disabled()"
            [attr.aria-invalid]="invalidRange() || null"
            (change)="set('end', $any($event.target).value)"
            (blur)="onTouched()"
          />
        </div>
        @if (clearable() && (value().start || value().end)) {
          <button
            type="button"
            class="cdf-range__clear"
            [disabled]="disabled()"
            (click)="clear()"
          >
            {{ 'ui.dateRange.clear' | translate }}
          </button>
        }
      </div>
      @if (presets().length) {
        <div
          class="cdf-range__presets"
          role="group"
          [attr.aria-label]="'ui.dateRange.presets' | translate"
        >
          @for (p of presets(); track p.label) {
            <button
              type="button"
              class="cdf-range__preset"
              [disabled]="disabled()"
              (click)="applyPreset(p)"
            >
              {{ p.label | translate }}
            </button>
          }
        </div>
      }
      @if (invalidRange()) {
        <p class="cdf-range__error" role="alert" [id]="errorId">
          {{ 'ui.dateRange.invalid' | translate }}
        </p>
      }
    </fieldset>
  `,
  styleUrl: './date-range-picker.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateRangePicker),
      multi: true,
    },
  ],
})
export class DateRangePicker implements ControlValueAccessor {
  /** Use `datetime-local` inputs (promotions start/end at a time). */
  readonly withTime = input(false);
  readonly legend = input<string | null>(null);
  readonly startLabel = input<string | null>(null);
  readonly endLabel = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly clearable = input(true);
  readonly presets = input<DateRangePreset[]>([]);
  /** Injected "today" for presets (tests / stories). */
  readonly today = input<Date | null>(null);

  protected readonly startId = `cdf-range-${++rangeSeq}-start`;
  protected readonly endId = `cdf-range-${rangeSeq}-end`;
  protected readonly errorId = `cdf-range-${rangeSeq}-error`;
  protected readonly value = signal<DateRange>({ start: null, end: null });
  protected readonly disabled = signal(false);
  protected readonly type = computed(() =>
    this.withTime() ? 'datetime-local' : 'date',
  );
  protected readonly invalidRange = computed(() =>
    isInvertedRange(this.value()),
  );

  private onChange: (v: DateRange) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(v: DateRange | null | undefined): void {
    this.value.set({ start: v?.start ?? null, end: v?.end ?? null });
  }
  registerOnChange(fn: (v: DateRange) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }

  protected set(side: 'start' | 'end', raw: string): void {
    this.emit({ ...this.value(), [side]: raw || null });
  }

  protected clear(): void {
    this.emit({ start: null, end: null });
  }

  protected applyPreset(p: DateRangePreset): void {
    const base = this.today() ?? new Date();
    const fmt = (offset: number, endOfDay: boolean) => {
      const d = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + offset,
      );
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return this.withTime() ? `${date}T${endOfDay ? '23:59' : '00:00'}` : date;
    };
    this.emit({
      start: fmt(p.startOffsetDays, false),
      end: fmt(p.endOffsetDays, true),
    });
  }

  private emit(v: DateRange): void {
    this.value.set(v);
    this.onChange(v);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
