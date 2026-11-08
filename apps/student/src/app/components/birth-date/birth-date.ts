import { Injectable, computed, inject, signal } from '@angular/core';
import { MeClient, type AgeGroup, type MeResponse } from '@codify/api-client';
import {
  checkBirthDate,
  localDay,
  type BirthDateProblem,
} from '@codify/domain';

/** The three date fields, in the order a locale writes dates. */
export type DatePart = 'day' | 'month' | 'year';

/** pt-BR (and most locales) write day/month/year; en-US month/day/year. */
export function datePartOrder(locale: string): DatePart[] {
  return /^en-US$/i.test(locale)
    ? ['month', 'day', 'year']
    : ['day', 'month', 'year'];
}

/** Localised month names, January first (for the month `<select>`). */
export function monthNames(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
  });
  return Array.from({ length: 12 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2000, i, 1))),
  );
}

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

/** Why the form can't be sent yet, as a `student.age.errors.*` key suffix. */
export type BirthDateFormProblem = 'incomplete' | BirthDateProblem;

/**
 * Typed parts → `YYYY-MM-DD`, or the problem with them. Checked the same
 * way the API checks (real date, not in the future, ≤ 120 years) on the
 * device's calendar day; the API has the last word on the account's zone.
 */
export function birthDateFromParts(
  parts: DateParts,
  now: Date = new Date(),
  timeZone?: string,
): { value: string } | { problem: BirthDateFormProblem } {
  const day = parts.day.trim();
  const month = parts.month.trim();
  const year = parts.year.trim();
  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{4}$/.test(year)
  )
    return { problem: 'incomplete' };
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const problem = checkBirthDate(value, localDay(now, timeZone));
  return problem ? { problem } : { value };
}

/**
 * The signed-in user's date-of-birth state for the student app (docs/05
 * Onboarding, docs/14 "Minors"). `birthDate` is undefined until GET /me
 * answered (offline: stays undefined — nothing is blocked that can't be
 * saved anyway), null when the user has not given one.
 *
 * The shell shows a blocking prompt while it is null, except on Today
 * while first-run onboarding is deciding or showing (its first step asks
 * for the date): `todayOnboarding` is 'pending' → 'onboarding' | 'none'.
 */
@Injectable({ providedIn: 'root' })
export class AgeGateService {
  private readonly meClient = inject(MeClient);

  readonly birthDate = signal<string | null | undefined>(undefined);
  readonly ageGroup = signal<AgeGroup | null | undefined>(undefined);
  /** `onboardedAt` from the same GET /me (null = never finished onboarding). */
  readonly onboarded = signal<boolean | undefined>(undefined);
  readonly todayOnboarding = signal<'pending' | 'onboarding' | 'none'>(
    'pending',
  );
  /** 12–17: the minor defaults apply (the API enforces them). */
  readonly isMinor = computed(() => this.ageGroup() === 'minor');

  private loading: Promise<void> | null = null;
  private loadedFor: string | null = null;

  /** Load (once per user) the date of birth from GET /me. */
  load(userId: string): Promise<void> {
    if (this.loadedFor === userId && this.loading) return this.loading;
    if (this.loadedFor !== userId) this.todayOnboarding.set('pending');
    this.loadedFor = userId;
    this.birthDate.set(undefined);
    this.ageGroup.set(undefined);
    this.onboarded.set(undefined);
    this.loading = this.meClient
      .me()
      .then((me) => this.accept(me))
      .catch(() => {
        // Offline / failed: unknown, so no prompt; the next load retries.
        this.loading = null;
      });
    return this.loading;
  }

  /** Take the state from a GET /me (or PUT /me/birth-date) response. */
  accept(me: Pick<MeResponse, 'birthDate' | 'ageGroup' | 'onboardedAt'>): void {
    // An older API without the field never blocks.
    if (me.birthDate === undefined) return;
    this.birthDate.set(me.birthDate ?? null);
    this.ageGroup.set(me.ageGroup ?? null);
    this.onboarded.set(me.onboardedAt !== null);
  }

  /** Forget everything (sign-out, deleted account). */
  reset(): void {
    this.loading = null;
    this.loadedFor = null;
    this.birthDate.set(undefined);
    this.ageGroup.set(undefined);
    this.onboarded.set(undefined);
    this.todayOnboarding.set('pending');
  }
}

/**
 * Should the shell's blocking prompt show? Only for a known missing date;
 * on Today, not while first-run onboarding (which asks first) is deciding
 * or showing for an account that never finished onboarding.
 */
export function showBirthDateGate(s: {
  birthDate: string | null | undefined;
  onboarded: boolean | undefined;
  onToday: boolean;
  todayOnboarding: 'pending' | 'onboarding' | 'none';
}): boolean {
  if (s.birthDate !== null) return false;
  if (s.onToday && s.onboarded === false && s.todayOnboarding !== 'none')
    return false;
  return true;
}
