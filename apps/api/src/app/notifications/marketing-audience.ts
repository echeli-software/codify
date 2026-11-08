import {
  adultBirthDateCutoff,
  canReceiveMarketing as domainCanReceiveMarketing,
  type AgeSubject,
} from '@codify/domain';

/**
 * Who may receive promotional notifications (PROMO push + campaign email)
 * and the one-time "Get alerts about bonus events?" prompt: known adults
 * only (launch decision 2026-11). Fail closed — no date of birth means the
 * user might be under 18, so no marketing. The rules are the shared age
 * helpers in `@codify/domain` (docs/15 Phase 14 "Age"); this file is the
 * one place notifications read them from.
 */

/**
 * Latest date of birth (`YYYY-MM-DD`) that is 18+ on every local day `now`
 * can fall on, for database filters (`birthDate <= cutoff`).
 */
export function marketingBirthDateCutoff(now: Date = new Date()): string {
  return adultBirthDateCutoff(now);
}

/** The cutoff as the `Date` Prisma compares a `@db.Date` column with. */
export function marketingBirthDateCutoffDate(now: Date = new Date()): Date {
  return new Date(`${marketingBirthDateCutoff(now)}T00:00:00Z`);
}

/**
 * May this user get promotional push / email or be asked to opt in?
 * Only a known adult, counted on the user's own local day.
 */
export function canReceiveMarketing(
  user: AgeSubject,
  now: Date = new Date(),
): boolean {
  return domainCanReceiveMarketing(user, now);
}
