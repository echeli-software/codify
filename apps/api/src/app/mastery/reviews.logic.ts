/**
 * Spaced-repetition review scheduling (docs/10 §7 "Mastery levels per
 * topic: Bronze/Silver/Gold via spaced-repetition checks"). A Leitner
 * system with five boxes: a completed lesson with a quiz becomes a card in
 * box 1, due a day later; a passed review moves it up one box (max 5) and
 * pushes it out by that box's interval, a missed one sends it back to box
 * 1. Pure functions, so the schedule is unit-tested without a DB.
 */

export const MIN_BOX = 1;
export const MAX_BOX = 5;

/** Days until the next review, by box (box 1 → index 0). */
export const BOX_INTERVAL_DAYS = [1, 3, 7, 16, 35] as const;

/** A review passes at this score or above (the quiz pass mark). */
export const REVIEW_PASS_PCT = 70;

/** GOLD needs every reviewable completed lesson in at least this box. */
export const GOLD_MIN_BOX = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `box` as an integer in [MIN_BOX, MAX_BOX] (bad input → box 1). */
export function clampBox(box: number): number {
  if (!Number.isFinite(box)) return MIN_BOX;
  return Math.min(MAX_BOX, Math.max(MIN_BOX, Math.trunc(box)));
}

/** Review interval of a box, in days. */
export function intervalDays(box: number): number {
  return BOX_INTERVAL_DAYS[clampBox(box) - 1];
}

/** When a card in `box` is next due, counted from `from`. */
export function dueAfter(from: Date, box: number): Date {
  return new Date(from.getTime() + intervalDays(box) * DAY_MS);
}

/** A new card for a lesson completed at `completedAt`: box 1, due +1 day. */
export function newCard(completedAt: Date): { box: number; dueAt: Date } {
  return { box: MIN_BOX, dueAt: dueAfter(completedAt, MIN_BOX) };
}

/** The card can be reviewed now. */
export function isDue(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() <= now.getTime();
}

export interface CardState {
  box: number;
  reviews: number;
  lapses: number;
}

export interface ReviewOutcome extends CardState {
  passed: boolean;
  dueAt: Date;
}

/**
 * Apply one graded review at `now`: a pass (`scorePct` ≥
 * {@link REVIEW_PASS_PCT}) moves the card up a box (max 5) and schedules it
 * by the new box; a miss drops it to box 1 (+1 day) and counts a lapse.
 */
export function nextReview(
  card: CardState,
  scorePct: number,
  now: Date,
): ReviewOutcome {
  const passed = scorePct >= REVIEW_PASS_PCT;
  const box = passed ? clampBox(clampBox(card.box) + 1) : MIN_BOX;
  return {
    passed,
    box,
    dueAt: dueAfter(now, box),
    reviews: card.reviews + 1,
    lapses: card.lapses + (passed ? 0 : 1),
  };
}

/**
 * The review half of the GOLD rule: every completed lesson that has a
 * review card sits in box ≥ {@link GOLD_MIN_BOX}. Lessons without a card
 * (nothing to quiz) don't block it.
 */
export function reviewsMastered(boxes: readonly number[]): boolean {
  return boxes.every((b) => b >= GOLD_MIN_BOX);
}
