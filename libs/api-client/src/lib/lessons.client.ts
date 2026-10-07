import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { LessonType } from './courses.client.js';

export interface Lesson {
  id: string;
  moduleId: string;
  courseId: string;
  order: number;
  type: LessonType;
  isFree: boolean;
  estimatedMinutes: number;
  baseXp: number;
  baseCoins: number;
  title: string;
  contentJson: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Lesson metadata without content. */
export type LessonMeta = Omit<Lesson, 'contentJson'>;

/**
 * GET /api/lessons/:id/offline-bundle (docs/16 §5). `doc` is a LessonDoc
 * with quiz answers stripped; `quizAnswerHashes` lets the app give instant
 * offline feedback with `checkQuizAnswerHash` from @codify/lesson-schema.
 */
export interface LessonOfflineBundle {
  lesson: LessonMeta;
  doc: unknown;
  quizAnswerHashes: {
    algorithm: 'sha256';
    salt: string;
    hashes: Record<string, string>;
  };
  /** Image URLs in the doc, for asset prefetch. */
  imageSrcs: string[];
  updatedAt: string;
}

/** GET /api/courses/:id/lesson-versions item. */
export interface LessonVersion {
  lessonId: string;
  updatedAt: string;
}

/** 400 body when `contentJson` fails `lessonDocSchema`. */
export interface LessonContentIssue {
  path: string;
  code: string;
  message: string;
}

export interface CreateLessonBody {
  title: string;
  type?: LessonType;
  isFree?: boolean;
  estimatedMinutes?: number;
  baseXp?: number;
  baseCoins?: number;
  order?: number;
  /** Optional initial LessonDoc (validated server-side). */
  contentJson?: unknown;
}

export interface UpdateLessonBody {
  title?: string;
  type?: LessonType;
  isFree?: boolean;
  estimatedMinutes?: number;
  baseXp?: number;
  baseCoins?: number;
  order?: number;
  contentJson?: unknown;
}

@Injectable({ providedIn: 'root' })
export class LessonsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  detail(id: string): Promise<Lesson> {
    return firstValueFrom(
      this.http.get<Lesson>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(id)}`,
      ),
    );
  }

  /**
   * Students without access get a 402 ProblemDetails carrying `reason` +
   * `requiredPlans`; quiz answers are stripped from student responses.
   */
  offlineBundle(id: string): Promise<LessonOfflineBundle> {
    return firstValueFrom(
      this.http.get<LessonOfflineBundle>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(id)}/offline-bundle`,
      ),
    );
  }

  /** `updatedAt` per lesson so downloads re-fetch only changed lessons. */
  lessonVersions(courseId: string): Promise<LessonVersion[]> {
    return firstValueFrom(
      this.http.get<LessonVersion[]>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(courseId)}/lesson-versions`,
      ),
    );
  }

  create(moduleId: string, body: CreateLessonBody): Promise<Lesson> {
    return firstValueFrom(
      this.http.post<Lesson>(
        `${this.config.baseUrl}/modules/${encodeURIComponent(moduleId)}/lessons`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  update(id: string, body: UpdateLessonBody): Promise<Lesson> {
    return firstValueFrom(
      this.http.patch<Lesson>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(id)}`,
      ),
    );
  }
}
