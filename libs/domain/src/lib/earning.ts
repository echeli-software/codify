/**
 * Earning rules (docs/07 §2, §5, §12) that are pure arithmetic: which base
 * reward a lesson pays, and how the daily per-source coin caps and the
 * weekly bonus pool split a grant. The API reads the numbers from
 * `GamificationConfig`; these functions only apply them.
 */

export interface RewardAmount {
  xp: number;
  coins: number;
}

export type EarningLessonType =
  | 'READING'
  | 'QUIZ'
  | 'EXERCISE'
  | 'AI_PROMPT'
  | 'SCENARIO'
  | 'CAPSTONE';

/** docs/07 §2 first-completion defaults per lesson type. */
export const DEFAULT_EARNING_BY_TYPE: Record<EarningLessonType, RewardAmount> =
  {
    READING: { xp: 10, coins: 5 },
    QUIZ: { xp: 15, coins: 8 },
    EXERCISE: { xp: 25, coins: 12 },
    AI_PROMPT: { xp: 20, coins: 10 },
    SCENARIO: { xp: 10, coins: 5 },
    // Not in the docs table: a capstone is graded like an AI prompt but is a
    // whole project, so it pays like an exercise pass by default.
    CAPSTONE: { xp: 25, coins: 12 },
  };

/** The `Lesson.baseXp` / `Lesson.baseCoins` column defaults (schema). */
export const LESSON_COLUMN_DEFAULTS: RewardAmount = { xp: 10, coins: 5 };

/**
 * Base reward for a first completion. Rule (documented in docs/07 §2):
 * per field, a value an author changed away from the column default
 * (10 XP / 5 coins) wins; a value still at the column default means "not
 * set" and the per-type default from config applies. So a quiz left at
 * 10/5 pays 15/8, a quiz the author set to 40 XP pays 40 XP + 8 coins, and
 * a reading lesson pays 10/5 either way. (Consequence: an author cannot
 * pin a non-reading lesson to exactly 10 XP or 5 coins — use 9/11.)
 */
export function lessonBaseReward(
  lesson: { type: string; baseXp: number; baseCoins: number },
  byType: Partial<Record<string, RewardAmount>> = DEFAULT_EARNING_BY_TYPE,
): RewardAmount {
  const def =
    byType[lesson.type] ??
    DEFAULT_EARNING_BY_TYPE[lesson.type as EarningLessonType] ??
    LESSON_COLUMN_DEFAULTS;
  return {
    xp: lesson.baseXp !== LESSON_COLUMN_DEFAULTS.xp ? lesson.baseXp : def.xp,
    coins:
      lesson.baseCoins !== LESSON_COLUMN_DEFAULTS.coins
        ? lesson.baseCoins
        : def.coins,
  };
}

export interface CoinCapSplit {
  /** Coins credited to the balance now. */
  granted: number;
  /** Coins moved into this week's bonus pool (paid when the week closes). */
  pooled: number;
  /** Coins dropped because the pool is full as well. */
  dropped: number;
}

/**
 * Split a coin grant against the source's daily cap (docs/07 §5: "max 200
 * coins/day from LESSON_COMPLETE; excess goes to a weekly bonus pool capped
 * at 500"). `cap` null / undefined = uncapped. Negative or zero amounts pass
 * through untouched.
 */
export function splitCoinsByCap(input: {
  amount: number;
  earnedTodayFromSource: number;
  dailyCap: number | null | undefined;
  poolSoFar: number;
  poolCap: number;
}): CoinCapSplit {
  const { amount } = input;
  if (amount <= 0 || input.dailyCap == null)
    return { granted: amount, pooled: 0, dropped: 0 };
  const room = Math.max(
    0,
    input.dailyCap - Math.max(0, input.earnedTodayFromSource),
  );
  const granted = Math.min(amount, room);
  const overflow = amount - granted;
  const poolRoom = Math.max(0, input.poolCap - Math.max(0, input.poolSoFar));
  const pooled = Math.min(overflow, poolRoom);
  return { granted, pooled, dropped: overflow - pooled };
}
