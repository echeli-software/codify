import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MAX_MULTIPLIER_VALUE } from '@codify/domain';

const KINDS = [
  'PREMIUM_DEFAULT',
  'COURSE_PROMO',
  'LESSON_PROMO',
  'STREAK_TIER',
  'CAMPAIGN',
] as const;
const TARGETS = ['XP', 'COINS', 'BOTH'] as const;

export class CreateMultiplierDto {
  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @IsOptional()
  @IsIn(TARGETS)
  target?: (typeof TARGETS)[number];

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(MAX_MULTIPLIER_VALUE)
  value!: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  courseId?: string | null;

  @IsOptional()
  @IsString()
  lessonId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  streakDaysMin?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Every field is patchable; `null` clears a nullable field (window bounds,
 * course/lesson binding, streak threshold, description). The merged row is
 * re-validated (value > 0, endsAt > startsAt, kind-specific binding).
 */
export class UpdateMultiplierDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsOptional()
  @IsIn(TARGETS)
  target?: (typeof TARGETS)[number];

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(MAX_MULTIPLIER_VALUE)
  value?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  courseId?: string | null;

  @IsOptional()
  @IsString()
  lessonId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  streakDaysMin?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListMultipliersQueryDto {
  /** `now` → only enabled rules whose window contains the current time. */
  @IsOptional()
  @IsIn(['now'])
  active?: 'now';

  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];
}
