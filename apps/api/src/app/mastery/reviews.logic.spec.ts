import {
  BOX_INTERVAL_DAYS,
  GOLD_MIN_BOX,
  MAX_BOX,
  MIN_BOX,
  REVIEW_PASS_PCT,
  clampBox,
  dueAfter,
  intervalDays,
  isDue,
  newCard,
  nextReview,
  reviewsMastered,
} from './reviews.logic.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-08T12:00:00Z');
const plusDays = (d: number) => new Date(now.getTime() + d * DAY);

describe('Leitner schedule (docs/10 §7)', () => {
  it('has five boxes at 1, 3, 7, 16 and 35 days', () => {
    expect([MIN_BOX, MAX_BOX]).toEqual([1, 5]);
    expect(BOX_INTERVAL_DAYS).toEqual([1, 3, 7, 16, 35]);
    expect([1, 2, 3, 4, 5].map(intervalDays)).toEqual([1, 3, 7, 16, 35]);
    expect(REVIEW_PASS_PCT).toBe(70);
    expect(GOLD_MIN_BOX).toBe(3);
  });

  it('clamps boxes into 1–5', () => {
    expect(clampBox(0)).toBe(1);
    expect(clampBox(-3)).toBe(1);
    expect(clampBox(9)).toBe(5);
    expect(clampBox(2.7)).toBe(2);
    expect(clampBox(Number.NaN)).toBe(1);
    expect(clampBox(Number.POSITIVE_INFINITY)).toBe(1);
    expect(intervalDays(42)).toBe(35);
  });

  it('schedules from a date by box', () => {
    expect(dueAfter(now, 1)).toEqual(plusDays(1));
    expect(dueAfter(now, 4)).toEqual(plusDays(16));
  });

  it('starts a completed lesson in box 1, due a day later', () => {
    expect(newCard(now)).toEqual({ box: 1, dueAt: plusDays(1) });
  });

  it('is due at and after dueAt', () => {
    expect(isDue(now, now)).toBe(true);
    expect(isDue(plusDays(-1), now)).toBe(true);
    expect(isDue(plusDays(1), now)).toBe(false);
  });

  it('moves a pass up one box and schedules by the new box', () => {
    const card = { box: 1, reviews: 0, lapses: 0 };
    expect(nextReview(card, 70, now)).toEqual({
      passed: true,
      box: 2,
      dueAt: plusDays(3),
      reviews: 1,
      lapses: 0,
    });
    expect(nextReview({ box: 2, reviews: 1, lapses: 0 }, 100, now)).toEqual(
      expect.objectContaining({ box: 3, dueAt: plusDays(7) }),
    );
    expect(
      nextReview({ box: 3, reviews: 2, lapses: 0 }, 90, now).dueAt,
    ).toEqual(plusDays(16));
  });

  it('keeps a pass in the last box at most', () => {
    expect(nextReview({ box: 5, reviews: 9, lapses: 1 }, 100, now)).toEqual({
      passed: true,
      box: 5,
      dueAt: plusDays(35),
      reviews: 10,
      lapses: 1,
    });
    expect(nextReview({ box: 4, reviews: 3, lapses: 0 }, 80, now).box).toBe(5);
  });

  it('drops a miss to box 1, due tomorrow, and counts a lapse', () => {
    expect(nextReview({ box: 4, reviews: 3, lapses: 1 }, 69, now)).toEqual({
      passed: false,
      box: 1,
      dueAt: plusDays(1),
      reviews: 4,
      lapses: 2,
    });
  });

  it('GOLD needs every reviewed lesson in box 3 or higher', () => {
    expect(reviewsMastered([])).toBe(true);
    expect(reviewsMastered([3, 5, 4])).toBe(true);
    expect(reviewsMastered([3, 2])).toBe(false);
  });
});
