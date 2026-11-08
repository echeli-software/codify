import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import type { LessonDoc } from '@codify/lesson-schema';
import type { MasteryLevel } from './mastery.logic.js';

export const REVIEW_QUEUE_DEFAULT = 10;
export const REVIEW_QUEUE_MAX = 20;

/** `GET /me/reviews?limit=` */
export class ReviewQueueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REVIEW_QUEUE_MAX)
  limit?: number;
}

/** `POST /me/reviews/:lessonId` — same answer shape as a quiz attempt. */
export class SubmitReviewDto {
  /** `{ [quizBlockId]: answerTokens[] }`. Unknown ids are ignored. */
  @IsObject()
  answers!: Record<string, unknown>;
}

export interface ReviewTopicRef {
  categoryId: string;
  slug: string;
  name: string;
}

export interface ReviewCardView {
  lessonId: string;
  lessonTitle: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: string | null;
  /** The course's categories (mastery topics). */
  topics: ReviewTopicRef[];
  /** Leitner box 1–5. */
  box: number;
  dueAt: string;
  reviews: number;
  lapses: number;
  /**
   * The lesson's quiz blocks only, in the caller's locale, with the answer
   * keys and explanations stripped (as for `GET /lessons/:id`).
   */
  doc: LessonDoc;
  questionCount: number;
}

export interface ReviewQueue {
  /** Cards due now (the page below is at most `limit` of them). */
  dueCount: number;
  /** When the next card not yet due comes up; null when none is waiting. */
  nextDueAt: string | null;
  items: ReviewCardView[];
}

export interface ReviewQuestionFeedback {
  id: string;
  correct: boolean;
  /** The key, revealed after grading: the card can't be retried until due. */
  correctOptionIds: string[];
  explanation: string | null;
}

export interface ReviewTopicMastery {
  categoryId: string | null;
  slug: string | null;
  name: string | null;
  mastery: MasteryLevel;
}

export interface ReviewResult {
  lessonId: string;
  scorePct: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passThresholdPct: number;
  perQuestion: ReviewQuestionFeedback[];
  card: {
    previousBox: number;
    box: number;
    dueAt: string;
    reviews: number;
    lapses: number;
  };
  /** Mastery of the topics this lesson's course belongs to, after the review. */
  topics: ReviewTopicMastery[];
  /** Cards still due after this one. */
  dueCount: number;
}
