import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';
import { StreakChip } from '../../molecules/streak-chip/streak-chip.js';
import { AppButton } from '../../atoms/app-button/app-button.js';

let streakWidgetSeq = 0;

export interface StreakDay {
  /** ISO date `YYYY-MM-DD` */
  date: string;
  /** True if the user completed at least one lesson that day. */
  completed: boolean;
  /** True if the day was a missed day saved by a freeze. */
  frozen?: boolean;
}

/**
 * Streak hub: 7-day calendar dot strip + current streak prominence +
 * available freezes + CTA to use a freeze. Used on the Today page hero
 * and inside the Profile page.
 *
 * The component is presentational: pass the last 7 days (oldest first)
 * and listen on `useFreeze` for the action click.
 */
@Component({
  selector: 'cdf-streak-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, StreakChip, AppButton, TranslatePipe],
  template: `
    <section class="cdf-streak-widget" [attr.aria-labelledby]="headingId">
      <header class="cdf-streak-widget__header">
        <h2 [id]="headingId" class="cdf-streak-widget__title">
          {{ 'ui.streak.title' | translate }}
        </h2>
        <cdf-streak-chip
          [days]="currentDays()"
          [freezes]="freezes()"
          [showLabel]="false"
        />
      </header>

      <ol
        class="cdf-streak-widget__week"
        [attr.aria-label]="
          'ui.streak.lastDays' | translate: { count: week().length }
        "
      >
        @for (day of week(); track day.date) {
          <li
            class="cdf-streak-widget__day"
            [class.cdf-streak-widget__day--done]="day.completed"
            [class.cdf-streak-widget__day--frozen]="day.frozen"
            [attr.aria-label]="
              'ui.streak.dayState.' + dayState(day)
                | translate: { date: day.date }
            "
            [title]="
              'ui.streak.dayState.' + dayState(day)
                | translate: { date: day.date }
            "
          >
            <span class="cdf-streak-widget__dot">
              @if (day.completed) {
                <cdf-icon name="flame" size="xs" />
              } @else if (day.frozen) {
                ❄
              }
            </span>
            <span class="cdf-streak-widget__day-label">{{
              shortLabel(day.date)
            }}</span>
          </li>
        }
      </ol>

      <footer class="cdf-streak-widget__footer">
        <p class="cdf-streak-widget__msg">
          {{ message().key | translate: message().params }}
        </p>
        @if ((freezes() ?? 0) > 0 && currentDays() > 0) {
          <cdf-app-button
            kind="secondary"
            size="sm"
            (buttonClick)="emitUseFreeze()"
          >
            {{ 'ui.streak.useFreeze' | translate }}
          </cdf-app-button>
        }
      </footer>
    </section>
  `,
  styleUrl: './streak-widget.scss',
})
export class StreakWidget {
  readonly currentDays = input.required<number>();
  readonly freezes = input<number | null>(0);
  readonly week = input.required<StreakDay[]>();
  readonly useFreezeClicked = output<void>();

  protected readonly headingId = `cdf-streak-heading-${++streakWidgetSeq}`;

  /** Motivational line → `ui.streak.message.*` key + params. */
  protected readonly message = computed(() => {
    const d = this.currentDays();
    if (d === 0) return { key: 'ui.streak.message.start', params: {} };
    if (d === 1) return { key: 'ui.streak.message.first', params: {} };
    if (d < 7)
      return {
        key: 'ui.streak.message.week',
        params: { days: d, left: 7 - d },
      };
    if (d < 30) return { key: 'ui.streak.message.month', params: { days: d } };
    if (d < 100)
      return { key: 'ui.streak.message.century', params: { days: d } };
    return { key: 'ui.streak.message.legendary', params: { days: d } };
  });

  protected dayState(day: StreakDay): 'completed' | 'frozen' | 'missed' {
    return day.completed ? 'completed' : day.frozen ? 'frozen' : 'missed';
  }

  protected shortLabel(iso: string): string {
    // ISO is `YYYY-MM-DD` — trust the format and skip Date parsing for SSR/tz safety.
    const parts = iso.split('-');
    return parts[2] ?? '';
  }

  protected emitUseFreeze(): void {
    this.useFreezeClicked.emit();
  }
}
