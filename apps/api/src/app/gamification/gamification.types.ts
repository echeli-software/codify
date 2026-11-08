import type { CoinSource, XpSource } from '@prisma/client';
import type { CompletedQuest } from './quests.service.js';

/** One line in the reward breakdown shown on the client toast. */
export interface RewardBreakdownEntry {
  /**
   * `base` (the un-multiplied amounts), a MultiplierKind (one factor), or
   * a bonus line: `QUIZ_PERFECT`, `QUIZ_QUESTIONS`, `STREAK_MILESTONE`,
   * `DAILY_CAP` (coins held back: negative `coins`, `pooled` to the week).
   */
  source: string;
  xp?: number;
  coins?: number;
  multiplier?: number;
  /** For multiplier lines: which side the factor applies to. */
  appliesTo?: 'xp' | 'coins' | 'both';
  /** DAILY_CAP line: coins moved into the weekly bonus pool. */
  pooled?: number;
}

export interface LevelUpInfo {
  newLevel: number;
  xpForNextLevel: number;
}

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  /** Reward responses only: this event counted a new streak day. */
  extended?: boolean;
  /** Reward responses only: freezes consumed to cover missed days. */
  freezesUsed?: number;
  /** Reward responses only: the streak had been lost and restarted at 1. */
  restartedAfterLoss?: boolean;
}

/** Exclusive cosmetic granted with a streak milestone (docs/10 §1). */
export interface MilestoneItem {
  id: string;
  slug: string;
  name: string;
}

export interface StreakMilestone {
  days: number;
  xp: number;
  coins: number;
  item?: MilestoneItem | null;
}

/** A short per-user XP boost (docs/10 §6). */
export interface SurpriseBoostInfo {
  id: string;
  value: number;
  target: 'XP' | 'COINS' | 'BOTH';
  startsAt: string;
  endsAt: string;
}

/** What the daily coin cap did to this grant (docs/07 §5). */
export interface CoinCapInfo {
  /** Coins the grant would have paid. */
  requested: number;
  /** Coins moved into this week's bonus pool (paid at week close). */
  pooled: number;
  /** Coins dropped because the pool was full too. */
  dropped: number;
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
  /** Set when this event pushed the streak onto a milestone day (§2 bonus). */
  streakMilestone?: StreakMilestone | null;
  /** Set when the daily per-source coin cap held coins back. */
  coinCap?: CoinCapInfo | null;
  /** A surprise boost that started with this event (applies to later rewards). */
  surpriseBoost?: SurpriseBoostInfo | null;
  /**
   * Daily quests this event completed (same list as the response's
   * `questsCompleted`), so the client celebration needs only the reward.
   */
  questsCompleted?: CompletedQuest[];
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
  /** Flat reward — skip multiplier resolution (quests, badges, milestones). */
  flat?: boolean;
  /** User-local TZ for streak day attribution. */
  timezone?: string;
  /** Offline attribution: the time the action actually happened. */
  clientTimestamp?: string | null;
  /** Skip the daily per-source coin caps (bonus-pool payouts, admin grants). */
  uncapped?: boolean;
}
