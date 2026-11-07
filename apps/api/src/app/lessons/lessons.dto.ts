import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const LESSON_TYPES = [
  'READING',
  'QUIZ',
  'EXERCISE',
  'AI_PROMPT',
  'SCENARIO',
  'CAPSTONE',
] as const;

/**
 * Body for POST /api/modules/:moduleId/lessons. `contentJson` defaults to
 * an empty Tiptap doc on the server when omitted, so the editor has
 * something to render after creation.
 */
export class CreateLessonDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsIn(LESSON_TYPES)
  type?: (typeof LESSON_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  estimatedMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  baseXp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  baseCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /**
   * Optional initial Tiptap doc. Migrated + validated against
   * `lessonDocSchema` server-side (400 with `issues` when invalid).
   */
  @IsOptional()
  @IsObject()
  contentJson?: unknown;
}

export class UpdateLessonDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsIn(LESSON_TYPES)
  type?: (typeof LESSON_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  estimatedMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  baseXp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  baseCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /**
   * Tiptap document JSON. Migrated (`migrateLessonDoc`) and validated
   * against `lessonDocSchema` before persisting; invalid docs are rejected
   * with 400 + `issues` (docs/14 §3). The whitelisted parse output is what
   * gets stored.
   */
  @IsOptional()
  @IsObject()
  contentJson?: unknown;
}

export interface LessonResponse {
  id: string;
  moduleId: string;
  courseId: string;
  order: number;
  type: (typeof LESSON_TYPES)[number];
  isFree: boolean;
  estimatedMinutes: number;
  baseXp: number;
  baseCoins: number;
  title: string;
  contentJson: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Lesson metadata without content (offline bundle, paywalled views). */
export type LessonMeta = Omit<LessonResponse, 'contentJson'>;

/**
 * GET /api/lessons/:id/offline-bundle — everything needed to read a lesson
 * offline (docs/16 §5). Quiz answer keys are NOT included in the doc;
 * `quizAnswerHashes` lets the client give instant feedback while the
 * server stays authoritative when attempts sync.
 */
export interface LessonOfflineBundle {
  lesson: LessonMeta;
  /** Access-checked LessonDoc with quiz answers stripped. */
  doc: unknown;
  quizAnswerHashes: {
    algorithm: 'sha256';
    /** Per-bundle salt; hash = sha256(salt NUL quizId NUL sortedIds joined by U+0001). */
    salt: string;
    hashes: Record<string, string>;
  };
  /** Image URLs referenced by the doc, for asset prefetch. */
  imageSrcs: string[];
  updatedAt: string;
}

/** GET /api/courses/:id/lesson-versions item. */
export interface LessonVersion {
  lessonId: string;
  updatedAt: string;
}
