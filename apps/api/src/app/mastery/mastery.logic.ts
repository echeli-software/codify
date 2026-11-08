/**
 * Per-topic mastery + skill-tree node states (docs/10 §7 "Long-arc
 * motivation"). Pure functions so the rules are unit-tested without a DB.
 */

import { reviewsMastered } from './reviews.logic.js';

export type MasteryLevel = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
export type SkillNodeState =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'AVAILABLE'
  | 'LOCKED';

/** Thresholds per level: completion share and the average best score. */
export const MASTERY_RULES = {
  BRONZE: { completion: 0, minLessons: 1 },
  SILVER: { completion: 0.5, score: 70 },
  GOLD: { completion: 1, score: 90 },
} as const;

/**
 * Mastery of a topic from completed lessons and quiz/exercise results:
 *   - GOLD: every lesson done, average best score ≥ 90 (or nothing graded),
 *     and every completed lesson's review card (spaced repetition,
 *     `reviews.logic.ts`) in box ≥ 3;
 *   - SILVER: ≥ 50 % done, average best score ≥ 70 (or nothing graded);
 *   - BRONZE: at least one lesson done;
 *   - NONE otherwise.
 * `scorePct` is null when the learner has no graded attempt in the topic.
 * `reviewBoxes` are the boxes of the completed lessons' review cards
 * (lessons without a quiz have none and don't block GOLD).
 */
export function masteryLevel(input: {
  lessonsTotal: number;
  lessonsCompleted: number;
  scorePct: number | null;
  reviewBoxes?: readonly number[];
}): MasteryLevel {
  const { lessonsTotal, lessonsCompleted, scorePct } = input;
  if (lessonsTotal <= 0 || lessonsCompleted <= 0) return 'NONE';
  const share = lessonsCompleted / lessonsTotal;
  const scoreOk = (min: number) => scorePct === null || scorePct >= min;
  if (
    share >= MASTERY_RULES.GOLD.completion &&
    scoreOk(MASTERY_RULES.GOLD.score) &&
    reviewsMastered(input.reviewBoxes ?? [])
  )
    return 'GOLD';
  if (
    share >= MASTERY_RULES.SILVER.completion &&
    scoreOk(MASTERY_RULES.SILVER.score)
  )
    return 'SILVER';
  return 'BRONZE';
}

/** Rounded mean, or null for no values. */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Skill-tree node states for a course's modules in order: a module lights
 * up when all its lessons are done; the next one is available; later ones
 * are locked behind their predecessor (shown, not enforced — lesson access
 * is still decided by the paywall rules).
 */
export function moduleStates(
  modules: readonly { lessonsTotal: number; lessonsCompleted: number }[],
): SkillNodeState[] {
  const out: SkillNodeState[] = [];
  let previousDone = true;
  for (const m of modules) {
    const done = m.lessonsTotal > 0 && m.lessonsCompleted >= m.lessonsTotal;
    if (done) out.push('COMPLETED');
    else if (m.lessonsCompleted > 0) out.push('IN_PROGRESS');
    else out.push(previousDone ? 'AVAILABLE' : 'LOCKED');
    previousDone = done || m.lessonsTotal === 0;
  }
  return out;
}
