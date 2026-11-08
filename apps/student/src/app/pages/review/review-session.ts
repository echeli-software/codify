import type { ReviewResult } from '@codify/api-client';
import type { LessonQuizResult } from '@codify/ui-bootstrap';

/** Leitner boxes of a review card (docs/10 §7). */
export const REVIEW_BOXES = [1, 2, 3, 4, 5] as const;

/** A graded review as the lesson renderer's per-question feedback. */
export function toReviewQuizView(r: ReviewResult): LessonQuizResult {
  return {
    scorePct: r.scorePct,
    passed: r.passed,
    perQuestion: r.perQuestion.map((q) => ({
      id: q.id,
      correct: q.correct,
      correctOptionIds: q.correctOptionIds,
      explanation: q.explanation,
    })),
  };
}

/** Whole days from `now` until `dueAt` (at least 1). */
export function daysUntil(dueAt: string, now: Date = new Date()): number {
  const ms = Date.parse(dueAt) - now.getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/** The result line: passed → "see you in N days", missed → "back tomorrow". */
export function reviewOutcome(
  r: ReviewResult,
  now: Date = new Date(),
): { key: string; params: Record<string, unknown> } {
  return r.passed
    ? {
        key: 'student.review.passed',
        params: { days: daysUntil(r.card.dueAt, now), box: r.card.box },
      }
    : { key: 'student.review.missed', params: { pct: r.scorePct } };
}
