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
  | 'mysteryChestOpen';

export type HapticIntensity = 'light' | 'medium' | 'heavy';

export interface BadgeRef {
  id: string;
  name: string;
  /** Curated icon name (matches Icon's IconName but stringly-typed here). */
  icon: string;
  description?: string;
}

export interface RewardBreakdownEntry {
  /** e.g. "first-completion", "weekend-multiplier", "premium-multiplier". */
  source: string;
  xp?: number;
  coins?: number;
  multiplier?: number;
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
}

/** Snapshot pushed by reward grants; mirrored by the state services. */
export interface RewardServerState {
  totalXp?: number;
  level?: number;
  coins?: number;
  streakDays?: number;
  freezesAvailable?: number;
}
