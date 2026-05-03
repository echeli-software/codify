import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { Icon } from '../../atoms/icon/icon.js';
import { StreakChip } from '../../molecules/streak-chip/streak-chip.js';
import { AppButton } from '../../atoms/app-button/app-button.js';

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
  imports: [Icon, StreakChip, AppButton],
  template: `
    <section class="cdf-streak-widget" aria-labelledby="cdf-streak-heading">
      <header class="cdf-streak-widget__header">
        <h2 id="cdf-streak-heading" class="cdf-streak-widget__title">Your streak</h2>
        <cdf-streak-chip
          [days]="currentDays()"
          [freezes]="freezes()"
          [showLabel]="false"
        />
      </header>

      <ol class="cdf-streak-widget__week" aria-label="Last 7 days">
        @for (day of week(); track day.date) {
        <li
          class="cdf-streak-widget__day"
          [class.cdf-streak-widget__day--done]="day.completed"
          [class.cdf-streak-widget__day--frozen]="day.frozen"
          [attr.aria-label]="dayAria(day)"
          [title]="dayAria(day)"
        >
          <span class="cdf-streak-widget__dot">
            @if (day.completed) {
            <cdf-icon name="flame" size="xs" />
            } @else if (day.frozen) {
            ❄
            }
          </span>
          <span class="cdf-streak-widget__day-label">{{ shortLabel(day.date) }}</span>
        </li>
        }
      </ol>

      <footer class="cdf-streak-widget__footer">
        <p class="cdf-streak-widget__msg">{{ message() }}</p>
        @if ((freezes() ?? 0) > 0 && currentDays() > 0) {
        <cdf-app-button
          kind="secondary"
          size="sm"
          (buttonClick)="emitUseFreeze()"
        >
          Use a freeze
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

  protected readonly message = computed(() => {
    const d = this.currentDays();
    if (d === 0) return 'Start a streak today — finish one lesson.';
    if (d === 1) return 'Day 1 — keep going tomorrow!';
    if (d < 7) return `${d} days strong. ${7 - d} to your first weekly badge.`;
    if (d < 30) return `${d} days! Aim for the 30-day mark.`;
    if (d < 100) return `${d} days. Century streak in sight.`;
    return `${d} days — legendary streak.`;
  });

  protected dayAria(day: StreakDay): string {
    const state = day.completed ? 'completed' : day.frozen ? 'frozen' : 'missed';
    return `${day.date}: ${state}`;
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
