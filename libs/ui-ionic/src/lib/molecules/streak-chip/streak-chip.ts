import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
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
  imports: [Icon, TranslatePipe],
  host: {
    '[attr.data-tier]': 'tierClass()',
    '[attr.data-cold]': 'days() === 0 ? "" : null',
  },
  template: `
    <span
      class="cdf-streak"
      role="img"
      [attr.aria-label]="
        ((freezes() ?? 0) > 0 ? 'ui.streak.ariaWithFreezes' : 'ui.streak.aria')
          | translate: { count: days(), freezes: freezes() ?? 0 }
      "
    >
      <cdf-icon name="flame" size="sm" />
      <span class="cdf-streak__days">{{ days() }}</span>
      @if (showLabel()) {
        <span class="cdf-streak__label">{{
          'ui.streak.dayUnit' | translate: { count: days() }
        }}</span>
      }
      @if ((freezes() ?? 0) > 0) {
        <span class="cdf-streak__sep" aria-hidden="true">·</span>
        <span class="cdf-streak__freezes" aria-hidden="true">
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
}
