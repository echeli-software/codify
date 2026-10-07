/**
 * Quiet-hours math (docs/10 §3). Windows are user-local minutes from
 * midnight; `null` falls back to the 22:00–08:00 default. A window may wrap
 * midnight (start > end). start === end means "no quiet hours".
 */

export const DEFAULT_QUIET_START = 22 * 60;
export const DEFAULT_QUIET_END = 8 * 60;
export const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

export interface LocalClock {
  /** 'YYYY-MM-DD' in the user's timezone. */
  date: string;
  /** Minutes since local midnight, 0..1439. */
  minutes: number;
}

/** The user-local calendar date + minute-of-day of an instant. */
export function localClock(
  at: Date,
  timeZone: string | null | undefined,
): LocalClock {
  const tz = timeZone || FALLBACK_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    // Unknown IANA zone stored on the user — fall back to the default.
    if (tz !== FALLBACK_TIMEZONE) return localClock(at, FALLBACK_TIMEZONE);
    throw new Error(`Cannot resolve timezone ${tz}`);
  }
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
  };
}

export function quietWindow(
  start: number | null | undefined,
  end: number | null | undefined,
): { start: number; end: number } {
  return {
    start: start ?? DEFAULT_QUIET_START,
    end: end ?? DEFAULT_QUIET_END,
  };
}

/** Is `minutes` (local minute-of-day) inside the [start, end) quiet window? */
export function isWithinQuietHours(
  minutes: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // wraps midnight
}

/** Minutes from `minutes` until the quiet window ends (0 when not quiet). */
export function minutesUntilQuietEnds(
  minutes: number,
  start: number,
  end: number,
): number {
  if (!isWithinQuietHours(minutes, start, end)) return 0;
  return (end - minutes + 1440) % 1440;
}
