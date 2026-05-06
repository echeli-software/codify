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

export interface CreateLessonBody {
  title: string;
  type?: LessonType;
  isFree?: boolean;
  estimatedMinutes?: number;
  baseXp?: number;
  baseCoins?: number;
  order?: number;
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
