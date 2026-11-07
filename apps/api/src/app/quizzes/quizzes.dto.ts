import { IsISO8601, IsObject, IsOptional } from 'class-validator';
import type { CompleteLessonResponse } from '../progress/progress.dto.js';

/** POST /api/lessons/:id/quiz/attempts */
export class SubmitQuizAttemptDto {
  /** `{ [quizBlockId]: selectedOptionIds[] }`. Unknown ids are ignored. */
  @IsObject()
  answers!: Record<string, unknown>;

  /** Offline-queue device time; same bounds as lesson completion. */
  @IsOptional()
  @IsISO8601({ strict: true })
  clientTimestamp?: string;
}

export interface QuizQuestionFeedback {
  id: string;
  correct: boolean;
  /** Revealed only once the quiz is passed, so a failed attempt can't be replayed into a pass. */
  correctOptionIds?: string[];
  explanation?: string | null;
}

export interface QuizAttemptResponse {
  attemptId: string;
  scorePct: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passThresholdPct: number;
  perQuestion: QuizQuestionFeedback[];
  /** Present when this attempt passed: the lesson completion (reward on first pass). */
  completion?: CompleteLessonResponse & { alreadyCompleted: boolean };
}

export interface QuizAttemptSummary {
  attemptId: string;
  scorePct: number;
  passed: boolean;
  createdAt: string;
}
