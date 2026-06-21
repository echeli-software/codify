import type { CoinSource, XpSource } from '@prisma/client';

/** One line in the reward breakdown shown on the client toast. */
export interface RewardBreakdownEntry {
  source: string;
  xp?: number;
  coins?: number;
  multiplier?: number;
}

export interface LevelUpInfo {
  newLevel: number;
  xpForNextLevel: number;
}

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
}

/**
 * Canonical reward returned by the grant pipeline — mirrors
 * `RewardCanonical`/`RewardPayload` in @codify/gamification-engine so the
 * client can drive RewardOrchestrator straight from the API response.
 */
export interface RewardResult {
  xp: number;
  coins: number;
  /** Effective XP multiplier (display). Coins multiplier is usually equal. */
  multiplier: number;
  xpMultiplier: number;
  coinMultiplier: number;
  breakdown: RewardBreakdownEntry[];
  totals: { totalXp: number; coins: number; level: number };
  levelUp: LevelUpInfo | null;
  streak: StreakInfo | null;
}

export interface GrantRewardParams {
  userId: string;
  baseXp: number;
  baseCoins: number;
  xpSource: XpSource;
  coinSource: CoinSource;
  refType?: string | null;
  refId?: string | null;
  /** Unique key — replays with the same key are no-ops (idempotent). */
  idempotencyKey?: string | null;
  /** Multiplier context. */
  courseId?: string | null;
  lessonId?: string | null;
  /** When true, this event advances the daily streak. */
  countsForStreak?: boolean;
  /** User-local TZ for streak day attribution. */
  timezone?: string;
  /** Offline attribution: the time the action actually happened. */
  clientTimestamp?: string | null;
}
