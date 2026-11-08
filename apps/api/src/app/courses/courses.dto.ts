import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { COURSE_SORTS, type CourseSort } from './course-discovery.js';
import type { TranslationMeta } from '../lessons/lessons.dto.js';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

/**
 * Body for POST /api/courses. `title` + `description` go into the
 * source-locale ContentTranslation rows the service writes inside the
 * same transaction as the Course row, so an admin sees the new course
 * in their UI language immediately.
 */
export class CreateCourseDto {
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-60 chars',
  })
  slug!: string;

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(2, 16)
  sourceLocale?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  estimatedMinutes?: number;

  /** Confirmed IMAGE/COVER asset id (POST /assets/presign → confirm). */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  coverAssetId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categoryIds?: string[];
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-60 chars',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  estimatedMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isCapstone?: boolean;

  /** Confirmed IMAGE/COVER asset id; `null` removes the cover. */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @Length(1, 64)
  coverAssetId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categoryIds?: string[];
}

export class ListCoursesQueryDto {
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: (typeof COURSE_STATUSES)[number];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  authorId?: string;

  /**
   * Staff only: `true` keeps courses with at least one missing or outdated
   * translation (course, module or lesson field) in a target locale.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  missingTranslations?: 'true' | 'false';

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  // ─── Student catalog discovery (docs/05 Catalog) — see course-discovery.ts

  /** Search title/description (any locale), slug and category names. */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  q?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  /** 'true' → only courses with a free preview lesson. */
  @IsOptional()
  @IsIn(['true', 'false'])
  free?: 'true' | 'false';

  /** 'true' → only courses without free lessons (subscription required). */
  @IsOptional()
  @IsIn(['true', 'false'])
  premium?: 'true' | 'false';

  /** Content language (source locale or a translated title), e.g. "en-US". */
  @IsOptional()
  @IsString()
  @Length(2, 16)
  language?: string;

  @IsOptional()
  @IsIn(COURSE_SORTS)
  sort?: CourseSort;

  // ─── Content locale (docs/11 §3 fetch pattern) ───────────────────────

  /** Content locale for titles/descriptions; overrides Accept-Language. */
  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;

  /**
   * 'false' → only courses whose title/description exist in the requested
   * locale (no source-locale fallback). Default 'true'.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  fallback?: 'true' | 'false';
}

export interface CourseListItem {
  id: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  difficulty: number;
  estimatedMinutes: number;
  isCapstone: boolean;
  coverAssetId: string | null;
  /** Public URL of the cover asset, or null when unset/unconfirmed. */
  coverUrl: string | null;
  sourceLocale: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorDisplayName: string;
  /** Title in the requested locale, falling back to source-locale. */
  title: string;
  description: string | null;
  /** True when the title came from a non-source-locale translation. */
  titleFromTranslation: boolean;
  categoryIds: string[];
  moduleCount: number;
  lessonCount: number;
  /** At least one live lesson is free ("free preview available", docs/05 §3). */
  hasFreePreview?: boolean;
  /**
   * List/detail reads (docs/11 §3 fetch pattern): `locale` = the content
   * locale asked for, `source` = the locale the text was served in
   * (≠ `locale` when any of it fell back), `fallback` = whether it did.
   * Detail counts module + lesson titles too.
   */
  _translation?: TranslationMeta;
}

export interface CourseLessonSummary {
  id: string;
  order: number;
  type: 'READING' | 'QUIZ' | 'EXERCISE' | 'AI_PROMPT' | 'SCENARIO' | 'CAPSTONE';
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
