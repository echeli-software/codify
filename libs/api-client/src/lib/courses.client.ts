import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type LessonType =
  | 'READING'
  | 'QUIZ'
  | 'EXERCISE'
  | 'AI_PROMPT'
  | 'SCENARIO'
  | 'CAPSTONE';

export interface CourseListItem {
  id: string;
  slug: string;
  status: CourseStatus;
  difficulty: number;
  estimatedMinutes: number;
  sourceLocale: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorDisplayName: string;
  title: string;
  description: string | null;
  /** True when title came from a non-source-locale translation. */
  titleFromTranslation: boolean;
  categoryIds: string[];
  moduleCount: number;
  lessonCount: number;
}

export interface CourseLessonSummary {
  id: string;
  order: number;
  type: LessonType;
  isFree: boolean;
  estimatedMinutes: number;
  title: string;
}

export interface CourseModuleSummary {
  id: string;
  order: number;
  title: string;
  lessons: CourseLessonSummary[];
}

export interface CourseDetail extends CourseListItem {
  modules: CourseModuleSummary[];
}

export interface CourseListResponse {
  items: CourseListItem[];
  total: number;
}

export interface ListCoursesQuery {
  status?: CourseStatus;
  categoryId?: string;
  authorId?: string;
  skip?: number;
  take?: number;
}

export interface CreateCourseBody {
  slug: string;
  title: string;
  description?: string;
  sourceLocale?: string;
  difficulty?: number;
  estimatedMinutes?: number;
  categoryIds?: string[];
}

export type UpdateCourseBody = Partial<CreateCourseBody>;

@Injectable({ providedIn: 'root' })
export class CoursesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  list(query: ListCoursesQuery = {}): Promise<CourseListResponse> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params = params.set(k, String(v));
    }
    return firstValueFrom(
      this.http.get<CourseListResponse>(`${this.config.baseUrl}/courses`, {
        params,
      }),
    );
  }

  detail(idOrSlug: string): Promise<CourseDetail> {
    return firstValueFrom(
      this.http.get<CourseDetail>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(idOrSlug)}`,
      ),
    );
  }

  create(body: CreateCourseBody): Promise<CourseListItem> {
    return firstValueFrom(
      this.http.post<CourseListItem>(`${this.config.baseUrl}/courses`, body, {
        context: withIdempotency(),
      }),
    );
  }

  update(id: string, body: UpdateCourseBody): Promise<CourseListItem> {
    return firstValueFrom(
      this.http.patch<CourseListItem>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  publish(id: string): Promise<CourseListItem> {
    return firstValueFrom(
      this.http.post<CourseListItem>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(id)}/publish`,
        {},
        { context: withIdempotency() },
      ),
    );
  }

  archive(id: string): Promise<CourseListItem> {
    return firstValueFrom(
      this.http.post<CourseListItem>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(id)}/archive`,
        {},
        { context: withIdempotency() },
      ),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(id)}`,
      ),
    );
  }
}
