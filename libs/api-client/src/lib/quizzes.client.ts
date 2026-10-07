import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { CompleteLessonResponse } from './progress.client.js';

export interface QuizQuestionFeedback {
  id: string;
  correct: boolean;
  /** Revealed only when the attempt passed. */
  correctOptionIds?: string[];
  explanation?: string | null;
}

export interface QuizAttemptResult {
  attemptId: string;
  scorePct: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passThresholdPct: number;
  perQuestion: QuizQuestionFeedback[];
  /** On a pass: the lesson completion (reward only on the first pass). */
  completion?: CompleteLessonResponse & { alreadyCompleted: boolean };
}

export interface QuizAttemptSummary {
  attemptId: string;
  scorePct: number;
  passed: boolean;
  createdAt: string;
}

/**
 * Server-graded quizzes (docs/06 §quiz). Errors: 402 paywall, 404
 * unpublished, 400 `NO_QUIZ` / client timestamp, 429 `QUIZ_ATTEMPT_COOLDOWN`.
 */
@Injectable({ providedIn: 'root' })
export class QuizzesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  submit(
    lessonId: string,
    answers: Record<string, string[]>,
    opts: { clientTimestamp?: string } = {},
  ): Promise<QuizAttemptResult> {
    return firstValueFrom(
      this.http.post<QuizAttemptResult>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(lessonId)}/quiz/attempts`,
        {
          answers,
          ...(opts.clientTimestamp
            ? { clientTimestamp: opts.clientTimestamp }
            : {}),
        },
        { context: withIdempotency() },
      ),
    );
  }

  mine(lessonId: string): Promise<QuizAttemptSummary[]> {
    return firstValueFrom(
      this.http.get<QuizAttemptSummary[]>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(lessonId)}/quiz/attempts`,
      ),
    );
  }
}
