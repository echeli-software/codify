import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { XpBadge } from '../../atoms/xp-badge/xp-badge.js';
import { CoinBadge } from '../../atoms/coin-badge/coin-badge.js';

/**
 * Tiny "+10 XP +5 coins" pill shown after a successful action. Pure
 * presentation — the RewardOrchestrator (Phase 3f) controls when/where
 * to mount it and animates its entrance/exit.
 *
 *   <cdf-reward-toast [xp]="10" [coins]="5" />
 *
 * Optional `multiplier` line surfaces the boost ("·×2" suffix) so users
 * see *why* the gain is large.
 */
@Component({
  selector: 'cdf-reward-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [XpBadge, CoinBadge],
  host: { '[attr.data-tone]': 'tone()' },
  template: `
    <div class="cdf-reward" role="status">
      @if (xp()) {
      <cdf-xp-badge [value]="xp()" size="sm" tone="gain" [showLabel]="false" />
      }
      @if (coins()) {
      <cdf-coin-badge [value]="coins()" size="sm" tone="gain" />
      }
      @if (showMultiplier()) {
      <span class="cdf-reward__mult">·{{ formattedMultiplier() }}</span>
      }
    </div>
  `,
  styleUrl: './reward-toast.scss',
})
export class RewardToast {
  readonly xp = input<number>(0);
  readonly coins = input<number>(0);
  /** Effective multiplier applied (e.g. 2.0). Hidden when ≤ 1. */
  readonly multiplier = input<number | null>(null);
  readonly tone = input<'plain' | 'level-up'>('plain');

  protected readonly showMultiplier = computed(() => {
    const m = this.multiplier();
    return m !== null && m > 1;
  });

  protected readonly formattedMultiplier = computed(() => {
    const m = this.multiplier() ?? 1;
    const isWhole = Number.isInteger(m);
    return `×${isWhole ? m.toFixed(0) : m.toFixed(2)}`;
  });
}
