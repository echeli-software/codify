import {
  Equals,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `PUT /api/me/birth-date`. The calendar check (real date, not in the
 * future, age ≤ 120) runs in BirthDateService against the user's own
 * local day, so the problem code names what is wrong.
 */
export class SetBirthDateDto {
  @IsString()
  @Matches(DATE_KEY, { message: 'birthDate must be a YYYY-MM-DD date' })
  birthDate!: string;
}

/** `POST /api/admin/users/:id/birth-date` — staff correction. */
export class CorrectBirthDateDto {
  @IsString()
  @Matches(DATE_KEY, { message: 'birthDate must be a YYYY-MM-DD date' })
  birthDate!: string;

  /** Typed confirmation — must be exactly "CORRECT". */
  @IsString()
  @Equals('CORRECT', { message: 'confirm must be "CORRECT"' })
  confirm!: string;

  /** Why (support ticket, document seen…). Audited; never the dates. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Staff correction outcome. The dates are never returned to staff. */
export interface BirthDateCorrectionResult {
  userId: string;
  before: { ageGroup: 'minor' | 'adult' | null };
  /** `deleted`: the corrected date was under 12, so the account was removed. */
  after: { ageGroup: 'minor' | 'adult' | null } | { deleted: true };
}
