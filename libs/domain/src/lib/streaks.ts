/**
 * Pure streak rules (docs/07 §6). The stored `Streak` row is only advanced
 * when the user does something that counts, so on its own it goes stale:
 * a user who stopped two days ago still has `currentDays = 12` in the row.
 * Everything that shows or acts on a streak (summary, profile, reminders,
 * the nightly reset job and the reward pipeline itself) settles the row
 * against "today" with these functions, so they all agree.
 *
 * Model:
 *   - `lastActivityDate` is a user-local calendar day (YYYY-MM-DD; the DB
 *     stores it as UTC midnight). It is the last day the streak was
 *     *covered* — by activity, or by a freeze.
 *   - A day without activity is a "missed" day. Missed days are covered by
 *     banked freezes, one per day, automatically (docs/07 §6 "auto-applied
 *     on a missed day"). Today never counts as missed — the user still has
 *     until local midnight.
 *   - When the freezes run out the streak is lost: `currentDays` becomes 0
 *     (the freezes that were applied first are used up too — the same
 *     outcome as the nightly job applying them one day at a time).
 *   - `longestDays` is never reduced.
 */

export interface StreakState {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  /** Last covered user-local day, YYYY-MM-DD. */
  lastActivityKey: string;
}

export interface SettledStreak extends StreakState {
  /** Freezes consumed to cover missed days by this settlement. */
  freezesUsed: number;
  /** True when the streak was lost (missed days beyond the banked freezes). */
  lost: boolean;
  /** Missed days found between lastActivityKey and yesterday. */
  missedDays: number;
  /** True when anything changed (the row needs writing). */
  changed: boolean;
}

/** User-local calendar date of `at` in `tz` as YYYY-MM-DD; UTC for unknown zones. */
export function localDateKey(at: Date, tz: string | null | undefined): string {
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

/** Whole-day difference a − b for YYYY-MM-DD keys. */
export function dayDiff(aKey: string, bKey: string): number {
  return Math.round(
    (Date.parse(`${aKey}T00:00:00Z`) - Date.parse(`${bKey}T00:00:00Z`)) /
      86_400_000,
  );
}

/** `key` shifted by `days` (YYYY-MM-DD). */
export function addDays(key: string, days: number): string {
  const t = Date.parse(`${key}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Apply freezes / loss for the days missed before `todayKey` (exclusive).
 * Pure — callers decide whether to persist (`changed`). A streak with no
 * days (`currentDays = 0`) has nothing to protect and is returned as is.
 */
export function settleStreak(s: StreakState, todayKey: string): SettledStreak {
  const base = {
    ...s,
    freezesUsed: 0,
    lost: false,
    missedDays: 0,
    changed: false,
  };
  if (s.currentDays <= 0) return base;
  const missed = dayDiff(todayKey, s.lastActivityKey) - 1;
  if (missed <= 0) return base;
  const yesterday = addDays(todayKey, -1);
  if (missed <= s.freezesAvailable) {
    return {
      ...s,
      freezesAvailable: s.freezesAvailable - missed,
      lastActivityKey: yesterday,
      freezesUsed: missed,
      lost: false,
      missedDays: missed,
      changed: true,
    };
  }
  return {
    ...s,
    currentDays: 0,
    freezesAvailable: 0,
    lastActivityKey: yesterday,
    freezesUsed: s.freezesAvailable,
    lost: true,
    missedDays: missed,
    changed: true,
  };
}

export interface AdvanceResult extends SettledStreak {
  /** True when today's activity added a day (false = already counted today). */
  extended: boolean;
  /** True when this activity started a streak again after one was lost. */
  restartedAfterLoss: boolean;
  /** Freeze earned by this advance (every 7th day, capped). */
  freezeEarned: boolean;
}

/**
 * A streak-satisfying action on `todayKey`: settle missed days, then count
 * today (+1, or 1 after a loss). Same day again = no change. Earns a freeze
 * on every 7th day, capped at `freezeCap`. `existing` null = first ever.
 */
export function advanceStreak(
  existing: StreakState | null,
  todayKey: string,
  freezeCap: number,
): AdvanceResult {
  if (!existing) {
    return {
      currentDays: 1,
      longestDays: 1,
      freezesAvailable: 0,
      lastActivityKey: todayKey,
      freezesUsed: 0,
      lost: false,
      missedDays: 0,
      changed: true,
      extended: true,
      restartedAfterLoss: false,
      freezeEarned: false,
    };
  }
  // Clock skew / an older offline event: the day is already counted.
  if (
    dayDiff(todayKey, existing.lastActivityKey) <= 0 &&
    existing.currentDays > 0
  ) {
    return {
      ...existing,
      freezesUsed: 0,
      lost: false,
      missedDays: 0,
      changed: false,
      extended: false,
      restartedAfterLoss: false,
      freezeEarned: false,
    };
  }
  const settled = settleStreak(existing, todayKey);
  const wasLost =
    settled.lost || (existing.currentDays <= 0 && existing.longestDays > 0);
  const currentDays = settled.currentDays + 1;
  let freezesAvailable = settled.freezesAvailable;
  let freezeEarned = false;
  if (currentDays % 7 === 0 && freezesAvailable < freezeCap) {
    freezesAvailable += 1;
    freezeEarned = true;
  }
  return {
    ...settled,
    currentDays,
    longestDays: Math.max(settled.longestDays, currentDays),
    freezesAvailable,
    lastActivityKey: todayKey,
    changed: true,
    extended: true,
    restartedAfterLoss: wasLost,
    freezeEarned,
  };
}

/** The streak as it stands today (display): settled, never persisted. */
export function effectiveStreak(
  s: StreakState | null,
  todayKey: string,
): {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  activeToday: boolean;
} {
  if (!s)
    return {
      currentDays: 0,
      longestDays: 0,
      freezesAvailable: 0,
      activeToday: false,
    };
  const settled = settleStreak(s, todayKey);
  return {
    currentDays: settled.currentDays,
    longestDays: settled.longestDays,
    freezesAvailable: settled.freezesAvailable,
    activeToday: settled.currentDays > 0 && s.lastActivityKey >= todayKey,
  };
}

/**
 * The instant the user-local day containing `at` began (local 00:00), for
 * "today so far" queries such as the daily coin caps. Uses the zone's
 * current offset, so on a DST-change day it can be off by the DST shift.
 */
export function localDayStart(at: Date, tz: string | null | undefined): Date {
  let h = 0;
  let m = 0;
  let sec = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? 0);
    h = get('hour');
    m = get('minute');
    sec = get('second');
  } catch {
    h = at.getUTCHours();
    m = at.getUTCMinutes();
    sec = at.getUTCSeconds();
  }
  return new Date(
    at.getTime() - at.getUTCMilliseconds() - ((h * 60 + m) * 60 + sec) * 1000,
  );
}
