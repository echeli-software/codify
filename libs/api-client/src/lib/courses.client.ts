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
  isCapstone: boolean;
  coverAssetId: string | null;
  /** Public URL of the cover image, or null. */
  coverUrl: string | null;
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
  /** At least one live lesson is free ("free preview available"). */
  hasFreePreview?: boolean;
  /**
   * List/detail reads (docs/11 §3): content locale asked for / served in,
   * and whether any text fell back to the course's source locale (detail
   * counts module + lesson titles too).
   */
  _translation?: CourseTranslationMeta;
}

export interface CourseTranslationMeta {
  locale: string;
  source: string;
  fallback: boolean;
}

/** Content-locale options for course reads (docs/11 §3 fetch pattern). */
export interface CourseContentQuery {
  /** Content locale; overrides Accept-Language. */
  locale?: string;
  /**
   * `false` → no source-locale fallback: the list drops courses not fully
   * translated; the detail answers 404 `TRANSLATION_NOT_AVAILABLE`.
   */
  fallback?: boolean;
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

export interface ListCoursesQuery extends CourseContentQuery {
  status?: CourseStatus;
  categoryId?: string;
  authorId?: string;
  skip?: number;
  take?: number;
  /** Server-side search: titles/descriptions (any locale), slug, category names. */
  q?: string;
  difficulty?: number;
  /** Only courses with a free preview lesson. */
  free?: boolean;
  /** Only courses without free lessons. */
  premium?: boolean;
  /** Content language (source locale or translated title). */
  language?: string;
  sort?: CourseSort;
}

/** Catalog sort orders (docs/05 Catalog). */
export type CourseSort = 'recommended' | 'newest' | 'popular' | 'shortest';

export interface CreateCourseBody {
  slug: string;
  title: string;
  description?: string;
  sourceLocale?: string;
  difficulty?: number;
  estimatedMinutes?: number;
  /** Confirmed IMAGE/COVER asset id. */
  coverAssetId?: string;
  categoryIds?: string[];
}

export type UpdateCourseBody = Partial<
  Omit<CreateCourseBody, 'coverAssetId'>
> & {
  isCapstone?: boolean;
  /** `null` removes the cover. */
  coverAssetId?: string | null;
};

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

  detail(
    idOrSlug: string,
    query: CourseContentQuery = {},
  ): Promise<CourseDetail> {
    let params = new HttpParams();
    if (query.locale) params = params.set('locale', query.locale);
    if (query.fallback !== undefined)
      params = params.set('fallback', String(query.fallback));
    return firstValueFrom(
      this.http.get<CourseDetail>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(idOrSlug)}`,
        { params },
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
