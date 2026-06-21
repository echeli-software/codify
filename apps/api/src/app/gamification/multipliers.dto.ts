import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const KINDS = ['PREMIUM_DEFAULT', 'COURSE_PROMO', 'LESSON_PROMO', 'STREAK_TIER', 'CAMPAIGN'] as const;
const TARGETS = ['XP', 'COINS', 'BOTH'] as const;

export class CreateMultiplierDto {
  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @IsOptional() @IsIn(TARGETS)
  target?: (typeof TARGETS)[number];

  @IsNumber() @Min(1) @Max(50)
  value!: number;

  @IsOptional() @IsString()
  startsAt?: string | null;

  @IsOptional() @IsString()
  endsAt?: string | null;

  @IsOptional() @IsString()
  courseId?: string | null;

  @IsOptional() @IsString()
  lessonId?: string | null;

  @IsOptional() @IsInt() @Min(1) @Max(100000)
  streakDaysMin?: number | null;

  @IsOptional() @IsString() @Length(0, 200)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateMultiplierDto {
  @IsOptional() @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsOptional() @IsIn(TARGETS)
  target?: (typeof TARGETS)[number];

  @IsOptional() @IsNumber() @Min(1) @Max(50)
  value?: number;

  @IsOptional() @IsString()
  startsAt?: string | null;

  @IsOptional() @IsString()
  endsAt?: string | null;

  @IsOptional() @IsString()
  courseId?: string | null;

  @IsOptional() @IsString()
  lessonId?: string | null;

  @IsOptional() @IsInt() @Min(1) @Max(100000)
  streakDaysMin?: number | null;

  @IsOptional() @IsString() @Length(0, 200)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
