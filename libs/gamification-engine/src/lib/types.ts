/**
 * Public types consumed across the gamification engine. The `RewardPayload`
 * is what `RewardOrchestrator.grant()` accepts and is the canonical shape
 * of any reward event coming back from the server (see docs/07-gamification.md
 * §11). Everything is pure data — no DOM/Angular leaks here so the types
 * can be reused on the server side too.
 */

export type RewardKind =
  | 'lessonComplete'
  | 'quizPass'
  | 'exercisePass'
  | 'aiPromptComplete'
  | 'scenarioComplete'
  | 'dailyQuestComplete'
  | 'streakMilestone'
  | 'levelUp'
  | 'badgeUnlock'
  | 'leaguePromotion'
  | 'mysteryChestOpen'
  /** Coins from a redeemed promo code (docs/08 §12). */
  | 'promoCode';

export type HapticIntensity = 'light' | 'medium' | 'heavy';

export interface BadgeRef {
  id: string;
  /** Badge slug (analytics `badge_unlocked`). */
  slug?: string;
  name: string;
  /** Curated icon name (matches Icon's IconName but stringly-typed here). */
  icon: string;
  description?: string;
}

export interface RewardBreakdownEntry {
  /**
   * `base`, a multiplier kind (`PREMIUM_DEFAULT`, `COURSE_PROMO`, …) or a
   * bonus line (`QUIZ_PERFECT`, `QUIZ_QUESTIONS`, `STREAK_MILESTONE`,
   * `DAILY_CAP`).
   */
  source: string;
  xp?: number;
  coins?: number;
  multiplier?: number;
  /** Multiplier lines: which side the factor applies to (default both). */
  appliesTo?: 'xp' | 'coins' | 'both';
  /** DAILY_CAP line: coins moved into the weekly bonus pool. */
  pooled?: number;
}

/** Streak milestone paid with this reward (docs/07 §2). */
export interface StreakMilestoneRef {
  days: number;
  xp: number;
  coins: number;
  /** Exclusive cosmetic granted with it (docs/10 §1). */
  item?: { id: string; name: string } | null;
}

/** A daily quest this reward completed (docs/07 §8). */
export interface QuestRef {
  id: string;
  /** QuestTemplate id (analytics `quest_complete`). */
  templateId?: string;
  title: string;
  xp: number;
  coins: number;
}

/** League promotion celebrated after the weekly rollover (docs/07 §9). */
export interface LeaguePromotionRef {
  tier: string;
  newTier: string;
  rank: number;
}

/** What this reward did to the streak (analytics + flame burst). */
export interface StreakChange {
  extended: boolean;
  freezesUsed: number;
  restartedAfterLoss: boolean;
}

/** A running per-user surprise boost (docs/10 §6). */
export interface SurpriseBoostRef {
  value: number;
  endsAt: string;
  target?: 'XP' | 'COINS' | 'BOTH';
}

export interface RewardCanonical {
  /** Total XP granted (after multipliers). */
  xp: number;
  /** Total coins granted (after multipliers). */
  coins: number;
  /** Effective multiplier applied — display only. */
  multiplier?: number;
  /** Per-source breakdown for the toast / debug panel. */
  breakdown?: RewardBreakdownEntry[];
}

export interface LevelUpInfo {
  newLevel: number;
  xpForNextLevel?: number;
}

export interface RewardPayload {
  kind: RewardKind;
  canonical: RewardCanonical;
  /** Optional level-up trigger. */
  levelUp?: LevelUpInfo | null;
  /** Optional badge unlock(s) bundled with this reward. */
  badgesUnlocked?: BadgeRef[];
  /**
   * The DOM element that triggered this reward (e.g. the "Submit" button).
   * Used as the origin point for the coin-fly + xp-sparkle animations.
   * Optional: when absent, animations are skipped (counters still tween).
   */
  sourceEl?: HTMLElement | null;
  /** ISO timestamp the server stamped on this reward — useful for queue dedup. */
  serverTimestamp?: string;
  /** Streak milestone paid with this reward → milestone celebration. */
  streakMilestone?: StreakMilestoneRef | null;
  /** Daily quests completed by this reward → quest celebration. */
  questsCompleted?: QuestRef[];
  /** League promotion → overlay + a banner that persists into the next route. */
  leaguePromotion?: LeaguePromotionRef | null;
  /** Streak effect of this reward (extended / freeze used / restarted). */
  streakChange?: StreakChange | null;
  /** A surprise boost that started with this reward. */
  surpriseBoost?: SurpriseBoostRef | null;
  /** Coins the daily cap moved into the weekly bonus pool. */
  coinsPooled?: number;
  /**
   * Celebrate only: the server already counted these amounts (e.g. a league
   * reward paid at rollover) — counters do not move.
   */
  displayOnly?: boolean;
  /**
   * Canonical running totals the server returned with this reward
   * (`RewardResult.totals` + streak). When present the orchestrator tweens
   * to these exact values instead of `actual + canonical.xp` — so quest /
   * badge bonuses and concurrent devices never drift the counters.
   */
  totals?: RewardServerState | null;
}

/** Snapshot pushed by reward grants; mirrored by the state services. */
export interface RewardServerState {
  totalXp?: number;
  level?: number;
  coins?: number;
  streakDays?: number;
  freezesAvailable?: number;
  bestDays?: number;
}

/** One multiplier factor shown in the reward toast ("×2 premium"). */
export interface RewardMultiplierPart {
  /** Breakdown `source`, e.g. `PREMIUM_DEFAULT`, `STREAK_TIER`. */
  source: string;
  value: number;
  /** Short English label used in `text` ("premium", "streak"). */
  label: string;
  /** i18n key for the label (`gamification.multiplier.*`). */
  labelKey: string;
}

/** A bonus line on the toast ("Perfect quiz +10 XP · +5 coins"). */
export interface RewardBonusLine {
  source: string;
  xp: number;
  coins: number;
  /** i18n key (`gamification.reward.bonus.*`). */
  labelKey: string;
}

/**
 * Emitted once per orchestration run on `RewardOrchestrator.toast` — the
 * caller renders it (RewardToast / ion-toast). Under reduced motion it
 * also carries the level-up / badges that would otherwise be overlays.
 */
export interface RewardToastEvent {
  /** Monotonic id so identical consecutive toasts still re-render. */
  id: number;
  kinds: RewardKind[];
  xp: number;
  coins: number;
  multiplier: number | null;
  /** Every factor (> 1) of the breakdown (XP or coins). */
  parts: RewardMultiplierPart[];
  /** Factors that multiplied the XP. */
  xpParts: RewardMultiplierPart[];
  /** Factors that multiplied the coins (e.g. a coins-only course promo). */
  coinParts: RewardMultiplierPart[];
  /** Bonus lines (perfect quiz, per-question, streak milestone). */
  bonuses: RewardBonusLine[];
  /** Coins the daily cap moved into the weekly bonus pool. */
  coinsPooled: number;
  /** Ready-made English line, e.g. "+240 XP (×2 premium × 1.2 streak)". */
  text: string;
  levelUp: LevelUpInfo | null;
  badges: BadgeRef[];
  streakMilestone: StreakMilestoneRef | null;
  quests: QuestRef[];
  leaguePromotion: LeaguePromotionRef | null;
  streakChange: StreakChange | null;
  /** Streak after this run (when the server sent it). */
  streakDays: number | null;
  freezesLeft: number | null;
  /** Lessons completed this session when it hit a multiple of 3, else null. */
  microCelebration: number | null;
  surpriseBoost: SurpriseBoostRef | null;
  /** True when overlays were replaced by this toast (reduced motion). */
  replacesOverlays: boolean;
}

/** Persistent celebration banner (league promotion, docs/07 §11). */
export interface RewardBanner {
  id: number;
  kind: 'leaguePromotion';
  promotion: LeaguePromotionRef;
  xp: number;
  coins: number;
}

/** What `grant()` resolves with once the counters reached the totals. */
export interface RewardGrantResult {
  /** Final canonical totals applied to the state services. */
  totals: { totalXp: number; coins: number };
  toast: RewardToastEvent;
  /** Resolves when every overlay of this run was dismissed (or none). */
  overlays: Promise<void>;
}
