import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { EXERCISE_LANGUAGES } from '@codify/domain';

/** POST /admin/users/:id/grants (docs/04 Users "Manual grant"). */
export class StaffGrantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  coins?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  xp?: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** POST /admin/system-notices/terms-update (docs/10 §3 SYSTEM). */
export class TermsUpdateDto {
  /** Identifies the terms revision, e.g. "2026-11-08". One send per version. */
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/)
  version!: string;

  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  /** Typed confirmation (sends to every active account). */
  @IsIn(['NOTIFY ALL USERS'])
  confirm!: 'NOTIFY ALL USERS';
}

export class ExerciseHealthQueryDto {
  @IsOptional()
  @IsIn(EXERCISE_LANGUAGES)
  language?: string;
}

/** POST /admin/exercise-health/retest. */
export class RetestDto {
  @IsIn(EXERCISE_LANGUAGES)
  language!: string;
}
