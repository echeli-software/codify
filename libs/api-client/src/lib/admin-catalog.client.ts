import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { CourseListResponse, ListCoursesQuery } from './courses.client.js';
import type { Item, ItemCategory } from './items.client.js';
import type { MeResponse } from './types.js';

// ─── Courses list / bulk ──────────────────────────────────────────────────

export interface AdminCourseListQuery extends ListCoursesQuery {
  /** Only courses with a missing or outdated translation (staff). */
  missingTranslations?: boolean;
}

export type BulkCourseAction = 'publish' | 'archive' | 'setCategories';

export interface BulkCoursesBody {
  ids: string[];
  action: BulkCourseAction;
  categoryIds?: string[];
}

export interface BulkCoursesResult {
  action: BulkCourseAction;
  updated: string[];
  failed: { id: string; status: number; message: string }[];
}

export interface CourseAuthor {
  id: string;
  displayName: string;
  courseCount: number;
}

// ─── Curriculum ───────────────────────────────────────────────────────────

export interface CurriculumOrderBody {
  modules: { id: string; lessonIds: string[] }[];
}

export interface CurriculumOrderResult {
  modules: { id: string; order: number; lessonIds: string[] }[];
}

export interface DuplicatedLesson {
  id: string;
  moduleId: string;
  order: number;
  type: string;
  isFree: boolean;
  estimatedMinutes: number;
  title: string;
  copied: { exercise: boolean; aiPrompt: boolean; scenario: boolean };
}

export interface FreeLessonsResult {
  freeLessonIds: string[];
  previousFreeLessonIds: string[];
}

// ─── Course insights ──────────────────────────────────────────────────────

export type TranslationFieldStatus = 'missing' | 'outdated' | 'done';

export interface CourseTranslationsReport {
  sourceLocale: string;
  locales: {
    locale: string;
    total: number;
    done: number;
    outdated: number;
    missing: number;
    pct: number;
  }[];
  entities: {
    entityType: 'COURSE' | 'MODULE' | 'LESSON';
    entityId: string;
    label: string;
    fields: Record<string, Record<string, TranslationFieldStatus>>;
  }[];
}

export interface CourseAnalyticsReport {
  courseId: string;
  generatedAt: string;
  lessonCount: number;
  funnel: {
    enrolled: number;
    started: number;
    half: number;
    completed: number;
  };
  lessons: {
    lessonId: string;
    moduleId: string;
    title: string;
    opened: number;
    completed: number;
    dropOffPct: number | null;
  }[];
  conversions: { source: string; enrolled: number; convertedToPaid: number }[];
}

export interface CourseEnrollmentRow {
  learner: string;
  userId: string | null;
  displayName: string | null;
  source: string;
  enrolledAt: string;
  completedLessons: number;
  lastCompletedAt: string | null;
}

export interface CourseMultiplierRow {
  id: string;
  kind: string;
  target: string;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  lessonId: string | null;
  description: string | null;
  isActive: boolean;
  activeNow: boolean;
}

// ─── Promotions / badges ──────────────────────────────────────────────────

export interface MultiplierPreviewDimension {
  effective: number;
  uncapped: number;
  capped: boolean;
  components: { kind: string; value: number; description: string | null }[];
  base: number;
  reward: number;
}

export interface MultiplierPreview {
  at: string;
  user: {
    id: string;
    displayName: string;
    isPremium: boolean;
    streakDays: number;
  };
  lesson: { id: string; courseId: string; title: string };
  cap: number;
  xp: MultiplierPreviewDimension;
  coins: MultiplierPreviewDimension;
}

export interface BadgeRuleValidation {
  valid: boolean;
  problems: string[];
  events: string[];
  metrics: string[];
}

// ─── Shop ─────────────────────────────────────────────────────────────────

export interface DropCopy {
  title: string;
  body: string;
}

export interface ScheduleDropBody {
  itemIds: string[];
  startsAt: string;
  endsAt: string | null;
  copy: { 'pt-BR': DropCopy; 'en-US': DropCopy };
}

export interface ScheduledDrop {
  itemIds: string[];
  startsAt: string;
  endsAt: string | null;
  reannounce: string[];
}

// ─── Site settings / theme ────────────────────────────────────────────────

export type ThemePreference = 'light' | 'dark' | 'system' | 'high-contrast';

export interface SiteConfig {
  branding: { tokens: Record<string, string>; label: string | null };
  locales: { enabled: string[]; default: string };
}

export interface SiteSettingsAdmin extends SiteConfig {
  brandingTokens: string[];
}

export interface UpdateSiteSettingsBody {
  branding?: { tokens: Record<string, string>; label: string | null };
  enabledLocales?: string[];
}

/**
 * Admin catalog endpoints added for docs/04 (courses list filters + bulk,
 * curriculum editing, course detail tabs, promotions preview, badge rule
 * check, drop wizard, site settings, per-account theme).
 */
@Injectable({ providedIn: 'root' })
export class AdminCatalogClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private course(id: string, rest: string): string {
    return this.url(`/courses/${encodeURIComponent(id)}${rest}`);
  }

  listCourses(query: AdminCourseListQuery = {}): Promise<CourseListResponse> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== null && v !== '')
        params = params.set(k, String(v));
    return firstValueFrom(
      this.http.get<CourseListResponse>(this.url('/courses'), { params }),
    );
  }

  courseAuthors(): Promise<CourseAuthor[]> {
    return firstValueFrom(
      this.http.get<CourseAuthor[]>(this.url('/admin/course-authors')),
    );
  }

  bulkCourses(body: BulkCoursesBody): Promise<BulkCoursesResult> {
    return firstValueFrom(
      this.http.post<BulkCoursesResult>(this.url('/courses/bulk'), body, {
        context: withIdempotency(),
      }),
    );
  }

  reorderCurriculum(
    courseId: string,
    body: CurriculumOrderBody,
  ): Promise<CurriculumOrderResult> {
    return firstValueFrom(
      this.http.put<CurriculumOrderResult>(
        this.course(courseId, '/curriculum/order'),
        body,
      ),
    );
  }

  duplicateLesson(
    courseId: string,
    lessonId: string,
  ): Promise<DuplicatedLesson> {
    return firstValueFrom(
      this.http.post<DuplicatedLesson>(
        this.course(
          courseId,
          `/lessons/${encodeURIComponent(lessonId)}/duplicate`,
        ),
        {},
        { context: withIdempotency() },
      ),
    );
  }

  setFreeLessons(
    courseId: string,
    lessonIds: string[],
  ): Promise<FreeLessonsResult> {
    return firstValueFrom(
      this.http.put<FreeLessonsResult>(this.course(courseId, '/free-lessons'), {
        lessonIds,
      }),
    );
  }

  courseTranslations(courseId: string): Promise<CourseTranslationsReport> {
    return firstValueFrom(
      this.http.get<CourseTranslationsReport>(
        this.course(courseId, '/translations'),
      ),
    );
  }

  courseAnalytics(courseId: string): Promise<CourseAnalyticsReport> {
    return firstValueFrom(
      this.http.get<CourseAnalyticsReport>(this.course(courseId, '/analytics')),
    );
  }

  courseEnrollments(
    courseId: string,
    opts: { skip?: number; take?: number } = {},
  ): Promise<{ items: CourseEnrollmentRow[]; total: number }> {
    let params = new HttpParams();
    if (opts.skip !== undefined) params = params.set('skip', String(opts.skip));
    if (opts.take !== undefined) params = params.set('take', String(opts.take));
    return firstValueFrom(
      this.http.get<{ items: CourseEnrollmentRow[]; total: number }>(
        this.course(courseId, '/enrollments'),
        { params },
      ),
    );
  }

  courseMultipliers(courseId: string): Promise<CourseMultiplierRow[]> {
    return firstValueFrom(
      this.http.get<CourseMultiplierRow[]>(
        this.course(courseId, '/multipliers'),
      ),
    );
  }

  previewMultiplier(body: {
    userId: string;
    lessonId: string;
    at?: string;
  }): Promise<MultiplierPreview> {
    return firstValueFrom(
      this.http.post<MultiplierPreview>(
        this.url('/admin/multipliers/preview'),
        body,
      ),
    );
  }

  validateBadgeRule(rule: unknown): Promise<BadgeRuleValidation> {
    return firstValueFrom(
      this.http.post<BadgeRuleValidation>(
        this.url('/admin/badges/validate-rule'),
        {
          rule,
        },
      ),
    );
  }

  /** Items readable by ADMIN and SUPPORT (docs/04 §1). */
  listShopItems(): Promise<Item[]> {
    return firstValueFrom(this.http.get<Item[]>(this.url('/admin/items')));
  }

  listShopCategories(): Promise<ItemCategory[]> {
    return firstValueFrom(
      this.http.get<ItemCategory[]>(this.url('/admin/items/categories')),
    );
  }

  scheduleDrop(body: ScheduleDropBody): Promise<ScheduledDrop> {
    return firstValueFrom(
      this.http.post<ScheduledDrop>(this.url('/admin/items/drops'), body, {
        context: withIdempotency(),
      }),
    );
  }

  /** Public site config (branding tokens + enabled locales). */
  siteConfig(): Promise<SiteConfig> {
    return firstValueFrom(this.http.get<SiteConfig>(this.url('/site-config')));
  }

  siteSettings(): Promise<SiteSettingsAdmin> {
    return firstValueFrom(
      this.http.get<SiteSettingsAdmin>(this.url('/admin/site-settings')),
    );
  }

  updateSiteSettings(body: UpdateSiteSettingsBody): Promise<SiteSettingsAdmin> {
    return firstValueFrom(
      this.http.put<SiteSettingsAdmin>(this.url('/admin/site-settings'), body),
    );
  }

  /** The caller's staff theme (User.theme via GET /me). */
  async getTheme(): Promise<ThemePreference | null> {
    const me = await firstValueFrom(
      this.http.get<MeResponse & { theme?: ThemePreference | null }>(
        this.url('/me'),
      ),
    );
    return me.theme ?? null;
  }

  setTheme(theme: ThemePreference | null): Promise<unknown> {
    return firstValueFrom(this.http.patch(this.url('/me'), { theme }));
  }
}

/**
 * Public site config for any app (`GET /api/site-config`): branding token
 * overrides and enabled locales (docs/04 Settings).
 */
@Injectable({ providedIn: 'root' })
export class SiteConfigClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  get(): Promise<SiteConfig> {
    return firstValueFrom(
      this.http.get<SiteConfig>(`${this.config.baseUrl}/site-config`),
    );
  }
}
