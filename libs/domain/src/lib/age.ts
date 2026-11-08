/**
 * Age rules (launch decision 2026-11: Codify is for ages 12 and up;
 * 12–17 are "minors" with safer defaults). Pure — no I/O.
 *
 * Dates of birth are calendar dates (`YYYY-MM-DD`, `User.birthDate` is a
 * Postgres `date`). A user's age is counted on *their* local calendar day
 * (`User.timezone`), so a birthday starts at local midnight, not UTC.
 *
 * Fail closed: an account with no date of birth is neither a minor nor an
 * adult (`ageGroup` null). Callers that unlock something for adults only
 * (marketing, a public profile, discovery, the activity feed) must check
 * `isKnownAdult` / `canReceiveMarketing`, never `!isMinor`.
 */

/** Youngest age allowed to hold an account. */
export const MINIMUM_AGE = 12;
/** Age from which the minor defaults no longer apply. */
export const ADULT_AGE = 18;
/** Oldest believable age; older dates are refused as typos. */
export const MAX_AGE = 120;

/** Stored age groups. Under-12 accounts are deleted, so never stored. */
export type AgeGroup = 'minor' | 'adult';

/** Classification of a date of birth on a given day. */
export type AgeCheck = AgeGroup | 'under_minimum';

/** Why a date of birth was refused (`checkBirthDate`). */
export type BirthDateProblem = 'invalid' | 'future' | 'too_old';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    m - 1
  ] as number;
}

/** `YYYY-MM-DD` → parts, or null unless it is a real calendar date. */
export function parseDateKey(value: unknown): Ymd | null {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** True for a real `YYYY-MM-DD` calendar date. */
export function isDateKey(value: unknown): value is string {
  return parseDateKey(value) !== null;
}

/**
 * Whole years between `birthDate` and `today` (both `YYYY-MM-DD`). Someone
 * born on 29 February turns a year older on 1 March in common years.
 * Throws on a malformed date — validate with `checkBirthDate` first.
 */
export function ageOn(birthDate: string, today: string): number {
  const b = parseDateKey(birthDate);
  const t = parseDateKey(today);
  if (!b || !t) throw new RangeError('ageOn expects YYYY-MM-DD dates');
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age;
}

/** `today` (a `YYYY-MM-DD` key) shifted by whole years, clamped to month end. */
export function addYears(day: string, years: number): string {
  const p = parseDateKey(day);
  if (!p) throw new RangeError('addYears expects a YYYY-MM-DD date');
  const y = p.y + years;
  const d = Math.min(p.d, daysInMonth(y, p.m));
  return `${String(y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Validate a date of birth entered on `today`: a real date, not in the
 * future and at most MAX_AGE years ago. Null when acceptable.
 */
export function checkBirthDate(
  birthDate: unknown,
  today: string,
): BirthDateProblem | null {
  if (!isDateKey(birthDate)) return 'invalid';
  if (birthDate > today) return 'future';
  if (ageOn(birthDate, today) > MAX_AGE) return 'too_old';
  return null;
}

/** Group for an (already valid) date of birth on `today`. */
export function classifyAge(birthDate: string, today: string): AgeCheck {
  const age = ageOn(birthDate, today);
  if (age < MINIMUM_AGE) return 'under_minimum';
  return age < ADULT_AGE ? 'minor' : 'adult';
}

/** `YYYY-MM-DD` of `at` in time zone `tz` (falls back to UTC). */
export function localDay(at: Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** A stored date of birth (`Date` at UTC midnight, or a key) as `YYYY-MM-DD`. */
export function birthDateKey(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string')
    return isDateKey(value.slice(0, 10)) ? value.slice(0, 10) : null;
  return Number.isNaN(value.getTime())
    ? null
    : value.toISOString().slice(0, 10);
}

/** What the age rules need from a user row. */
export interface AgeSubject {
  birthDate: Date | string | null | undefined;
  timezone?: string | null;
}

/**
 * The user's age group today, in their own time zone: `minor` (12–17),
 * `adult` (18+), or null when no date of birth was given. A stored date
 * under 12 (which the API never keeps) also reads as `minor`.
 */
export function ageGroup(
  user: AgeSubject,
  now: Date = new Date(),
): AgeGroup | null {
  const birth = birthDateKey(user.birthDate);
  if (!birth) return null;
  const check = classifyAge(birth, localDay(now, user.timezone));
  return check === 'adult' ? 'adult' : 'minor';
}

/** 12–17 today. False when the age is unknown — see `isKnownAdult`. */
export function isMinor(user: AgeSubject, now: Date = new Date()): boolean {
  return ageGroup(user, now) === 'minor';
}

/** 18+ today. False when the age is unknown (fail closed). */
export function isKnownAdult(
  user: AgeSubject,
  now: Date = new Date(),
): boolean {
  return ageGroup(user, now) === 'adult';
}

/**
 * May this user get promotional push or email, or opt in to marketing
 * email? Adults only; an unknown age counts as "might be under 18".
 */
export function canReceiveMarketing(
  user: AgeSubject,
  now: Date = new Date(),
): boolean {
  return isKnownAdult(user, now);
}

/**
 * The latest date of birth that is 18+ on every local calendar day that
 * `now` can fall on (UTC−12 … UTC+14). For database filters that cannot
 * evaluate each row's time zone: `birthDate <= adultBirthDateCutoff(now)`
 * selects only users who are adults wherever they are — someone turning
 * 18 today counts as a minor for up to a day longer, never the reverse.
 */
export function adultBirthDateCutoff(now: Date = new Date()): string {
  const earliestLocalDay = localDay(
    new Date(now.getTime() - 12 * 3_600_000),
    'UTC',
  );
  return addYears(earliestLocalDay, -ADULT_AGE);
}
