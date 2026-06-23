import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export interface CourseListItem {
  id: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  difficulty: number;
  estimatedMinutes: number;
  isCapstone: boolean;
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
}

export interface CourseLessonSummary {
  id: string;
  order: number;
  type: 'READING' | 'QUIZ' | 'EXERCISE' | 'AI_PROMPT' | 'SCENARIO';
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
