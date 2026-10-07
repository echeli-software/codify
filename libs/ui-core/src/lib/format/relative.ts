/**
 * Relative dates: "in 2 minutes", "3 hours ago", "yesterday". Uses
 * Intl.RelativeTimeFormat which handles all locales (incl. plurals).
 */

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

export function formatRelative(
  date: Date | number | string,
  locale: string,
  now: Date | number = Date.now(),
): string {
  const target = new Date(date).getTime();
  const ref = new Date(now).getTime();
  const diffMs = target - ref;
  const absMs = Math.abs(diffMs);

  // Within 30 seconds, use "now" rather than "in N seconds" — feels weird.
  if (absMs < 30_000) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      0,
      'second',
    );
  }

  // absMs ≥ 30s here, so the 'second' row (1000ms) always matches.
  const { unit, ms } = UNITS.find(
    (u) => absMs >= u.ms,
  ) as (typeof UNITS)[number];
  const value = Math.round(diffMs / ms);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    value,
    unit,
  );
}

/** Alias matching the docs/03 name. */
export const formatRelativeDate = formatRelative;
