import type { RewardResult, UnlockedBadge } from '@codify/api-client';
import type { RewardKind, RewardPayload } from '@codify/gamification-engine';

/**
 * Build the `RewardOrchestrator.grant()` payload from a server reward,
 * including the canonical running totals (XP, coins, level, streak) so the
 * counters land on the server's numbers, not on `actual + delta`.
 */
export function rewardPayload(
  kind: RewardKind,
  reward: RewardResult,
  badges: readonly UnlockedBadge[] | undefined,
  sourceEl: HTMLElement | null,
): RewardPayload {
  return {
    kind,
    canonical: {
      xp: reward.xp,
      coins: reward.coins,
      multiplier: reward.multiplier,
      breakdown: reward.breakdown,
    },
    totals: {
      totalXp: reward.totals.totalXp,
      coins: reward.totals.coins,
      level: reward.totals.level,
      ...(reward.streak
        ? {
            streakDays: reward.streak.currentDays,
            freezesAvailable: reward.streak.freezesAvailable,
            bestDays: reward.streak.longestDays,
          }
        : {}),
    },
    levelUp: reward.levelUp
      ? {
          newLevel: reward.levelUp.newLevel,
          xpForNextLevel: reward.levelUp.xpForNextLevel,
        }
      : null,
    badgesUnlocked: (badges ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      icon: b.icon,
      description: b.description,
    })),
    sourceEl,
  };
}

/** Seconds to wait from a 429 problem body (`retryAfter`), if present. */
export function retryAfterSeconds(
  data: Record<string, unknown> | undefined,
): number | null {
  const v = data?.['retryAfter'];
  return typeof v === 'number' && v > 0 ? Math.ceil(v) : null;
}
