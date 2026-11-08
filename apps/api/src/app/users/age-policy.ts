import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  addYears,
  adultBirthDateCutoff,
  isKnownAdult,
  localDay,
  ADULT_AGE,
  type AgeSubject,
} from '@codify/domain';

/**
 * API side of the 12+ rules (docs/14 "Minors"). The pure rules live in
 * `@codify/domain` (`ageGroup`, `isMinor`, `isKnownAdult`,
 * `canReceiveMarketing`); this file adds the Prisma filters and the
 * refusal the minor defaults share.
 *
 * Minor defaults apply to every account that is not a known adult: 12–17,
 * and accounts with no date of birth yet (fail closed).
 */

/** Columns the age rules read. */
export const AGE_SELECT = { birthDate: true, timezone: true } as const;

/** `YYYY-MM-DD` → the `Date` Prisma compares a `@db.Date` column with. */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/**
 * Users who are 18+ wherever they are today (`adultBirthDateCutoff`): the
 * filter for anything discoverable or promotional. Excludes minors and
 * users with no date of birth.
 */
export function knownAdultWhere(now: Date = new Date()): Prisma.UserWhereInput {
  return { birthDate: { lte: dateOnly(adultBirthDateCutoff(now)) } };
}

/** Admin `ageGroup` list filter values (`none` = not given). */
export const AGE_GROUP_FILTERS = ['minor', 'adult', 'none'] as const;
export type AgeGroupFilter = (typeof AGE_GROUP_FILTERS)[number];

/**
 * Admin Users filter. Uses the UTC calendar day (a list filter, not a
 * policy decision), so a user whose 18th birthday is today may sit in the
 * neighbouring group for a few hours.
 */
export function ageGroupWhere(
  group: AgeGroupFilter | undefined,
  now: Date = new Date(),
): Prisma.UserWhereInput {
  if (!group) return {};
  if (group === 'none') return { birthDate: null };
  const cutoff = dateOnly(addYears(localDay(now, 'UTC'), -ADULT_AGE));
  return group === 'adult'
    ? { birthDate: { lte: cutoff } }
    : { birthDate: { gt: cutoff } };
}

/** Settings a minor (or an account with no date of birth) cannot turn on. */
export type AgeRestrictedSetting = 'activityFeedOptIn' | 'marketingEmailOptIn';

/**
 * 403 `AGE_RESTRICTED` unless the user is a known adult. `setting` names
 * what was refused so the client can explain it.
 */
export function assertAdultFor(
  user: AgeSubject,
  setting: AgeRestrictedSetting,
  now: Date = new Date(),
): void {
  if (isKnownAdult(user, now)) return;
  throw new ForbiddenException({
    code: 'AGE_RESTRICTED',
    message:
      setting === 'activityFeedOptIn'
        ? 'Sharing activity with friends is not available for users under 18'
        : 'Marketing emails are not available for users under 18',
    setting,
  });
}

/**
 * Fields reset when an account becomes a minor (a date of birth set or
 * corrected to 12–17): the minor defaults win over earlier opt-ins.
 */
export const MINOR_RESET = {
  activityFeedOptIn: false,
  marketingEmailOptIn: false,
} as const satisfies Prisma.UserUpdateInput;
