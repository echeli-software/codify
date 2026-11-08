import type { ReviewResult } from '@codify/api-client';
import { daysUntil, reviewOutcome, toReviewQuizView } from './review-session';

const now = new Date('2026-11-08T12:00:00Z');
const result = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  lessonId: 'l1',
  scorePct: 100,
  passed: true,
  correctCount: 2,
  totalCount: 2,
  passThresholdPct: 70,
  perQuestion: [
    { id: 'q1', correct: true, correctOptionIds: ['a'], explanation: 'x' },
  ],
  card: {
    previousBox: 2,
    box: 3,
    dueAt: '2026-11-15T12:00:00Z',
    reviews: 2,
    lapses: 0,
  },
  topics: [],
  dueCount: 0,
  ...over,
});

describe('review session helpers', () => {
  it('maps a result to renderer feedback', () => {
    expect(toReviewQuizView(result())).toEqual({
      scorePct: 100,
      passed: true,
      perQuestion: [
        { id: 'q1', correct: true, correctOptionIds: ['a'], explanation: 'x' },
      ],
    });
  });

  it('counts whole days until the next review', () => {
    expect(daysUntil('2026-11-15T12:00:00Z', now)).toBe(7);
    expect(daysUntil('2026-11-08T13:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-11-01T00:00:00Z', now)).toBe(1);
  });

  it('words the outcome', () => {
    expect(reviewOutcome(result(), now)).toEqual({
      key: 'student.review.passed',
      params: { days: 7, box: 3 },
    });
    expect(reviewOutcome(result({ passed: false, scorePct: 50 }), now)).toEqual(
      { key: 'student.review.missed', params: { pct: 50 } },
    );
  });
});
