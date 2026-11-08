import type {
  LastWeekResult,
  RewardResult,
  UnlockedBadge,
} from '@codify/api-client';
import type { RewardKind, RewardPayload } from '@codify/gamification-engine';

/**
 * Build the `RewardOrchestrator.grant()` payload from a server reward,
 * including the canonical running totals (XP, coins, level, streak) so the
 * counters land on the server's numbers, not on `actual + delta`, and
 * everything the celebration needs from the same response: the streak
 * milestone (and its exclusive cosmetic), the daily quests it completed,
 * what happened to the streak (extended / freeze used / restarted — also
 * drives the analytics events), coins the daily cap moved into the weekly
 * pool, and a surprise boost that just started.
 */
export function rewardPayload(
  kind: RewardKind,
  reward: RewardResult,
  badges: readonly UnlockedBadge[] | undefined,
  sourceEl: HTMLElement | null,
): RewardPayload {
  const milestone = reward.streakMilestone ?? null;
  return {
    kind,
    canonical: {
      xp: reward.xp,
      coins: reward.coins,
      multiplier: Math.max(
        reward.xpMultiplier ?? reward.multiplier,
        reward.coinMultiplier ?? reward.multiplier,
      ),
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
      slug: b.slug,
      name: b.name,
      icon: b.icon,
      description: b.description,
    })),
    streakMilestone: milestone
      ? {
          days: milestone.days,
          xp: milestone.xp,
          coins: milestone.coins,
          item: milestone.item
            ? { id: milestone.item.id, name: milestone.item.name }
            : null,
        }
      : null,
    questsCompleted: (reward.questsCompleted ?? []).map((q) => ({
      id: q.id,
      templateId: q.templateId,
      title: q.title,
      xp: q.xpReward,
      coins: q.coinReward,
    })),
    streakChange:
      reward.streak && reward.streak.extended !== undefined
        ? {
            extended: reward.streak.extended,
            freezesUsed: reward.streak.freezesUsed ?? 0,
            restartedAfterLoss: reward.streak.restartedAfterLoss ?? false,
          }
        : null,
    coinsPooled: reward.coinCap?.pooled ?? 0,
    surpriseBoost: reward.surpriseBoost
      ? {
          value: reward.surpriseBoost.value,
          endsAt: reward.surpriseBoost.endsAt,
          target: reward.surpriseBoost.target,
        }
      : null,
    sourceEl,
  };
}

/**
 * Celebration for last week's league promotion (docs/07 §9, §11). The
 * reward was paid at rollover, so the payload is display-only: the toast,
 * overlay and persistent banner play, the counters don't move.
 */
export function leaguePromotionPayload(lw: LastWeekResult): RewardPayload {
  return {
    kind: 'leaguePromotion',
    canonical: { xp: lw.xpReward, coins: lw.coinReward },
    leaguePromotion: {
      tier: lw.tier,
      newTier: lw.newTier,
      rank: lw.finalRank,
    },
    displayOnly: true,
  };
}

/** Seconds to wait from a 429 problem body (`retryAfter`), if present. */
export function retryAfterSeconds(
  data: Record<string, unknown> | undefined,
): number | null {
  const v = data?.['retryAfter'];
  return typeof v === 'number' && v > 0 ? Math.ceil(v) : null;
}
