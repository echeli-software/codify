import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const KINDS = [
  'LESSON_COUNT',
  'CATEGORY_LESSON_COUNT',
  'XP_AMOUNT',
  'STREAK_MAINTAIN',
  'EXERCISE_PASS',
] as const;

export class CreateQuestTemplateDto {
  @IsString()
  @Length(2, 50)
  @Matches(SLUG)
  slug!: string;

  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  difficulty?: number;

  /** Relative weight within its difficulty band for the daily picker. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  target!: number;

  @IsOptional()
  @IsObject()
  paramsJson?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  xpReward?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  coinReward?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateQuestTemplateDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  difficulty?: number;

  /** Relative weight within its difficulty band for the daily picker. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  target?: number;

  @IsOptional()
  @IsObject()
  paramsJson?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  xpReward?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  coinReward?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
