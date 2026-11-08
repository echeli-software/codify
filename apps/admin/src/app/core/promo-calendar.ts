/**
 * Pure helpers for the Promotions calendar and time-window filter (docs/04
 * Catalog → Promotions). Days are local calendar days; a window overlaps a
 * day when it starts before the day ends and ends after it starts (open
 * ends extend forever).
 */

export type CalendarMode = 'week' | 'month';
export type WindowFilter = 'all' | 'active' | 'upcoming' | 'ended' | 'range';

export interface Windowed {
  startsAt: string | null;
  endsAt: string | null;
  isActive?: boolean;
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-based start of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - dow);
}

/**
 * The days shown for `anchor`: 7 for a week, or full Monday-first weeks
 * covering the month (28–42 days).
 */
export function calendarDays(anchor: Date, mode: CalendarMode): Date[] {
  if (mode === 'week') {
    const s = startOfWeek(anchor);
    return Array.from(
      { length: 7 },
      (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i),
    );
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const s = startOfWeek(first);
  const days: Date[] = [];
  for (
    let d = s;
    d <= last || days.length % 7 !== 0;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  )
    days.push(d);
  return days;
}

/** Move the anchor one page back / forward. */
export function shiftAnchor(
  anchor: Date,
  mode: CalendarMode,
  dir: -1 | 1,
): Date {
  return mode === 'week'
    ? new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + 7 * dir,
      )
    : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

/** Does the window overlap [from, to)? */
export function overlaps(w: Windowed, from: Date, to: Date): boolean {
  const s = w.startsAt ? new Date(w.startsAt).getTime() : -Infinity;
  const e = w.endsAt ? new Date(w.endsAt).getTime() : Infinity;
  return s < to.getTime() && e > from.getTime();
}

export function onDay<T extends Windowed>(rows: readonly T[], day: Date): T[] {
  const from = startOfDay(day);
  return rows.filter((r) => overlaps(r, from, new Date(from.getTime() + DAY)));
}

/** Time-window filter for the promotions list. */
export function matchesWindow(
  w: Windowed,
  filter: WindowFilter,
  now: Date,
  range?: { from: Date | null; to: Date | null },
): boolean {
  const t = now.getTime();
  const s = w.startsAt ? new Date(w.startsAt).getTime() : -Infinity;
  const e = w.endsAt ? new Date(w.endsAt).getTime() : Infinity;
  switch (filter) {
    case 'active':
      return w.isActive !== false && s <= t && e >= t;
    case 'upcoming':
      return s > t;
    case 'ended':
      return e < t;
    case 'range':
      return overlaps(
        w,
        range?.from ?? new Date(-8.64e15),
        range?.to ?? new Date(8.64e15),
      );
    default:
      return true;
  }
}
