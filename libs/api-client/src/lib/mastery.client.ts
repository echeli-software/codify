import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type MasteryLevel = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
export type SkillNodeState =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'AVAILABLE'
  | 'LOCKED';

export interface SkillNode {
  moduleId: string;
  order: number;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  state: SkillNodeState;
  /** The module that unlocks this one (LOCKED nodes only). */
  prerequisiteModuleId: string | null;
}

/** Spaced-repetition review cards of the completed lessons (docs/10 §7). */
export interface ReviewSummary {
  /** Completed lessons with a review card (lessons with a quiz). */
  cards: number;
  /** Cards due now. */
  due: number;
  /** Cards in box ≥ 3 — GOLD needs all of them there. */
  mastered: number;
}

export interface MasteryCourse {
  courseId: string;
  slug: string;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  scorePct: number | null;
  mastery: MasteryLevel;
  /** Optional for older APIs. */
  reviews?: ReviewSummary;
  nodes: SkillNode[];
}

export interface MasteryTopic {
  /** Category id; null groups courses without a category. */
  categoryId: string | null;
  slug: string | null;
  name: string | null;
  iconName: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** Average best quiz / exercise score; null when nothing is graded yet. */
  scorePct: number | null;
  mastery: MasteryLevel;
  /** Optional for older APIs. */
  reviews?: ReviewSummary;
  courses: MasteryCourse[];
}

export interface MasteryView {
  topics: MasteryTopic[];
  totals: Record<MasteryLevel, number>;
  /** Review cards due now (optional for older APIs). */
  reviewsDue?: number;
}

/** A due review card (`GET /me/reviews`). */
export interface ReviewCard {
  lessonId: string;
  lessonTitle: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: string | null;
  topics: { categoryId: string; slug: string; name: string }[];
  /** Leitner box 1–5. */
  box: number;
  dueAt: string;
  reviews: number;
  lapses: number;
  /**
   * The lesson's quiz blocks only, answer keys stripped — a `LessonDoc`
   * (`@codify/lesson-schema`) for the lesson renderer.
   */
  doc: unknown;
  questionCount: number;
}

export interface ReviewQueue {
  dueCount: number;
  /** When the next card comes up; null when none is waiting. */
  nextDueAt: string | null;
  items: ReviewCard[];
}

export interface ReviewResult {
  lessonId: string;
  scorePct: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passThresholdPct: number;
  perQuestion: {
    id: string;
    correct: boolean;
    correctOptionIds: string[];
    explanation: string | null;
  }[];
  card: {
    previousBox: number;
    box: number;
    dueAt: string;
    reviews: number;
    lapses: number;
  };
  /** Mastery of the lesson's topics after the review. */
  topics: {
    categoryId: string | null;
    slug: string | null;
    name: string | null;
    mastery: MasteryLevel;
  }[];
  /** Cards still due. */
  dueCount: number;
}

/** Typed client for `GET /me/mastery` (skill tree) and `/me/reviews` (docs/10 §7). */
@Injectable({ providedIn: 'root' })
export class MasteryClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  mastery(): Promise<MasteryView> {
    return firstValueFrom(
      this.http.get<MasteryView>(`${this.config.baseUrl}/me/mastery`),
    );
  }

  /** Due spaced-repetition reviews, oldest first (`limit` 1–20, default 10). */
  reviews(limit?: number): Promise<ReviewQueue> {
    let params = new HttpParams();
    if (limit) params = params.set('limit', String(limit));
    return firstValueFrom(
      this.http.get<ReviewQueue>(`${this.config.baseUrl}/me/reviews`, {
        params,
      }),
    );
  }

  /**
   * Grade a due review server-side. 409 `review.not_due`, 404
   * `review.not_found`, 402 without access.
   */
  submitReview(
    lessonId: string,
    answers: Record<string, string[]>,
  ): Promise<ReviewResult> {
    return firstValueFrom(
      this.http.post<ReviewResult>(
        `${this.config.baseUrl}/me/reviews/${encodeURIComponent(lessonId)}`,
        { answers },
        { context: withIdempotency() },
      ),
    );
  }
}
