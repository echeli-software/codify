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

const LESSON_TYPES = ['READING', 'QUIZ', 'EXERCISE', 'AI_PROMPT', 'SCENARIO'] as const;

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
   * Tiptap document JSON. The shape is validated by the lesson-schema lib
   * on the client side; here we accept any object and let the renderer
   * surface a diagnostic if it's malformed.
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
