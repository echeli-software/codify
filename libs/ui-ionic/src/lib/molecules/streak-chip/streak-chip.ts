import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { Icon } from '../../atoms/icon/icon.js';

/**
 * Streak indicator with flame icon, day count, and an optional freeze
 * counter (📦 N). Tier coloring driven by the streak length per
 * docs/07-gamification.md §6 — at 7 days the flame brightens, at 30 it
 * glows, at 100 it gets a prestige treatment.
 *
 *   <cdf-streak-chip [days]="user.streak.currentDays" [freezes]="2" />
 */
@Component({
  selector: 'cdf-streak-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    '[attr.data-tier]': 'tierClass()',
    '[attr.data-cold]': 'days() === 0 ? "" : null',
  },
  template: `
    <span class="cdf-streak" role="img" [attr.aria-label]="ariaLabel()">
      <cdf-icon name="flame" size="sm" />
      <span class="cdf-streak__days">{{ days() }}</span>
      @if (showLabel()) {
      <span class="cdf-streak__label">{{ days() === 1 ? 'day' : 'days' }}</span>
      }
      @if ((freezes() ?? 0) > 0) {
      <span class="cdf-streak__sep" aria-hidden="true">·</span>
      <span class="cdf-streak__freezes" [attr.aria-label]="freezeLabel()">
        ❄ {{ freezes() }}
      </span>
      }
    </span>
  `,
  styleUrl: './streak-chip.scss',
})
export class StreakChip {
  readonly days = input.required<number>();
  /** Optional banked-freezes counter from docs/07 §6. */
  readonly freezes = input<number | null>(null);
  readonly showLabel = input(true);

  protected readonly tierClass = computed(() => {
    const d = this.days();
    if (d >= 365) return 'year';
    if (d >= 100) return 'century';
    if (d >= 30) return 'month';
    if (d >= 7) return 'week';
    return 'starter';
  });

  protected readonly ariaLabel = computed(() => {
    const d = this.days();
    return `${d}-day streak`;
  });

  protected readonly freezeLabel = computed(
    () => `${this.freezes()} freeze${(this.freezes() ?? 0) === 1 ? '' : 's'} available`,
  );
}
