/**
 * Pure league logic — weekly cohort competition (docs/07-gamification.md §9).
 * Tier transitions, the UTC week boundary, and the rollover ranking/rewards
 * are deterministic and unit-tested here; the API does the DB side.
 */

export type LeagueTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';

export const TIER_ORDER: LeagueTier[] = [
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'DIAMOND',
];

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
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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

export function nextTierAfter(
  tier: LeagueTier,
  promoted: boolean,
  demoted: boolean,
): LeagueTier {
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

/** Smallest cohort in which anyone is demoted. */
export const MIN_COHORT_FOR_DEMOTION = 5;

/**
 * How many members promote from a cohort of `n` (docs/07 §9).
 *
 * The spec's "top 7 of ~30" is a ratio (≈23%) designed for full cohorts;
 * applied literally to a 6-person cohort it would promote everyone, and to a
 * 3-person cohort it would promote people who did nothing. So the zone
 * scales with the cohort: round(n × 7/30), at least 1, at most 7, and never
 * the whole cohort (n − 1). A full 30-person cohort gets exactly the spec's 7.
 * Diamond never promotes.
 */
export function promoteZoneSize(
  n: number,
  tier: LeagueTier = 'BRONZE',
): number {
  if (tier === 'DIAMOND' || n <= 1) return 0;
  const scaled = Math.max(1, Math.round((n * PROMOTE_COUNT) / COHORT_CAPACITY));
  return Math.min(PROMOTE_COUNT, scaled, n - 1);
}

/**
 * How many members demote from a cohort of `n` (docs/07 §9 "bottom 5 of
 * ~30" ≈ 17%): round(n × 5/30), at least 1, at most 5 — but only once the
 * cohort has {@link MIN_COHORT_FOR_DEMOTION}+ members (relegating the
 * last of three people is noise, not competition) and never overlapping the
 * promotion zone. Bronze never demotes. A full cohort gets exactly 5.
 */
export function demoteZoneSize(n: number, tier: LeagueTier = 'GOLD'): number {
  if (tier === 'BRONZE' || n < MIN_COHORT_FOR_DEMOTION) return 0;
  const scaled = Math.max(1, Math.round((n * DEMOTE_COUNT) / COHORT_CAPACITY));
  return Math.min(DEMOTE_COUNT, scaled, n - promoteZoneSize(n, tier));
}

export interface RolloverRewards {
  promotion: { xp: number; coins: number; freeze: number };
  rank1: { xp: number; coins: number };
}

/**
 * Rank a cohort by weekly XP (ties broken by userId for determinism) and
 * compute promotion/demotion + rewards. The top {@link promoteZoneSize}
 * promote (never beyond Diamond) — but only members who earned XP this week;
 * the bottom {@link demoteZoneSize} demote (never below Bronze). The zones
 * scale with cohort size and never overlap. Promotion grants 50 XP / 100
 * coins / 1 freeze; the #1 finisher (with XP > 0) gets an extra 25 XP / 50
 * coins + a weekly badge. Reward amounts are overridable (admin config).
 */
export function computeRollover(
  members: RollMember[],
  tier: LeagueTier,
  rewards: RolloverRewards = {
    promotion: PROMOTION_REWARD,
    rank1: RANK1_REWARD,
  },
): RollResult[] {
  const sorted = [...members].sort(
    (a, b) =>
      b.weeklyXp - a.weeklyXp ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const n = sorted.length;
  const promoteN = promoteZoneSize(n, tier);
  const demoteN = demoteZoneSize(n, tier);
  return sorted.map((m, idx) => {
    const rank = idx + 1;
    const active = m.weeklyXp > 0;
    const promoted = rank <= promoteN && active;
    const demoted = rank > n - demoteN && !promoted;
    const isRank1 = rank === 1 && active;

    const rewardXp =
      (promoted ? rewards.promotion.xp : 0) + (isRank1 ? rewards.rank1.xp : 0);
    const rewardCoins =
      (promoted ? rewards.promotion.coins : 0) +
      (isRank1 ? rewards.rank1.coins : 0);
    const rewardFreeze = promoted ? rewards.promotion.freeze : 0;

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
