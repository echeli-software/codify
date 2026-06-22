/**
 * Pure league logic — weekly cohort competition (docs/07-gamification.md §9).
 * Tier transitions, the UTC week boundary, and the rollover ranking/rewards
 * are deterministic and unit-tested here; the API does the DB side.
 */

export type LeagueTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';

export const TIER_ORDER: LeagueTier[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];

/** Target cohort size — the API fills cohorts to this before opening a new one. */
export const COHORT_CAPACITY = 30;
export const PROMOTE_COUNT = 7;
export const DEMOTE_COUNT = 5;

/** Promotion reward (docs/07 §2). */
export const PROMOTION_REWARD = { xp: 50, coins: 100, freeze: 1 };
/** Extra reward for finishing #1 in the cohort. */
export const RANK1_REWARD = { xp: 25, coins: 50 };

/** UTC Monday 00:00 of the week containing `now`. */
export function currentWeekStart(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** The previous week's UTC Monday. */
export function previousWeekStart(now: Date = new Date()): Date {
  const ws = currentWeekStart(now);
  ws.setUTCDate(ws.getUTCDate() - 7);
  return ws;
}

export function tierUp(tier: LeagueTier): LeagueTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

export function tierDown(tier: LeagueTier): LeagueTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(i - 1, 0)];
}

export function nextTierAfter(tier: LeagueTier, promoted: boolean, demoted: boolean): LeagueTier {
  if (promoted) return tierUp(tier);
  if (demoted) return tierDown(tier);
  return tier;
}

export interface RollMember {
  userId: string;
  weeklyXp: number;
}

export interface RollResult {
  userId: string;
  rank: number;
  promoted: boolean;
  demoted: boolean;
  newTier: LeagueTier;
  rewardXp: number;
  rewardCoins: number;
  rewardFreeze: number;
  /** True for the cohort winner — awards a special weekly badge. */
  awardWeeklyBadge: boolean;
}

/**
 * Rank a cohort by weekly XP (ties broken by userId for determinism) and
 * compute promotion/demotion + rewards. Top {@link PROMOTE_COUNT} promote
 * (never beyond Diamond); bottom {@link DEMOTE_COUNT} demote (never below
 * Bronze). Promotion grants 50 XP / 100 coins / 1 freeze; the #1 finisher
 * gets an extra 25 XP / 50 coins + a weekly badge. Promotion wins ties with
 * demotion in tiny cohorts.
 */
export function computeRollover(members: RollMember[], tier: LeagueTier): RollResult[] {
  const sorted = [...members].sort(
    (a, b) => b.weeklyXp - a.weeklyXp || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const n = sorted.length;
  return sorted.map((m, idx) => {
    const rank = idx + 1;
    const inPromoteZone = rank <= PROMOTE_COUNT && tier !== 'DIAMOND';
    const inDemoteZone = rank > n - DEMOTE_COUNT && tier !== 'BRONZE';
    // Promotion wins when zones overlap in a small cohort.
    const promoted = inPromoteZone;
    const demoted = inDemoteZone && !promoted;
    const isRank1 = rank === 1;

    const rewardXp = (promoted ? PROMOTION_REWARD.xp : 0) + (isRank1 ? RANK1_REWARD.xp : 0);
    const rewardCoins = (promoted ? PROMOTION_REWARD.coins : 0) + (isRank1 ? RANK1_REWARD.coins : 0);
    const rewardFreeze = promoted ? PROMOTION_REWARD.freeze : 0;

    return {
      userId: m.userId,
      rank,
      promoted,
      demoted,
      newTier: nextTierAfter(tier, promoted, demoted),
      rewardXp,
      rewardCoins,
      rewardFreeze,
      awardWeeklyBadge: isRank1,
    };
  });
}
