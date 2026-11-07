import { localClock } from '../notifications/quiet-hours.js';

/** docs/10 §3: the reminder personalises after 7 days of session data. */
export const MIN_SESSION_DAYS = 7;
/** Remind 30 min after the typical session start. */
export const REMINDER_OFFSET_MIN = 30;
/** Default before learned: 20:00 user-local. */
export const DEFAULT_REMINDER_MINUTE = 20 * 60;
/** Analytics events counted as a session start (docs/10 §14). */
export const SESSION_START_EVENTS = ['session_start', 'app_opened'] as const;

/**
 * Typical session-start minute (user-local, 0..1439) from app-open
 * timestamps: the first open of each local day, then the median across
 * days. Null until there are at least `MIN_SESSION_DAYS` distinct days.
 */
export function typicalSessionStart(
  opens: readonly Date[],
  timeZone: string | null | undefined,
): number | null {
  const firstPerDay = new Map<string, number>();
  for (const at of opens) {
    const c = localClock(at, timeZone);
    const prev = firstPerDay.get(c.date);
    if (prev === undefined || c.minutes < prev)
      firstPerDay.set(c.date, c.minutes);
  }
  if (firstPerDay.size < MIN_SESSION_DAYS) return null;
  const sorted = [...firstPerDay.values()].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * When today's daily-quest reminder is due (user-local minute): the user's
 * explicit `reminderMinute`, else 30 min after their typical session
 * start, else 20:00.
 */
export function reminderMinuteFor(
  explicit: number | null | undefined,
  learnedStart: number | null,
): { minute: number; source: 'explicit' | 'learned' | 'default' } {
  if (explicit !== null && explicit !== undefined)
    return { minute: explicit, source: 'explicit' };
  if (learnedStart !== null)
    return {
      minute: (learnedStart + REMINDER_OFFSET_MIN) % 1440,
      source: 'learned',
    };
  return { minute: DEFAULT_REMINDER_MINUTE, source: 'default' };
}
