/**
 * Duration formatting in user-friendly units. The output is locale-agnostic
 * (numbers + a unit hint); call sites localize the unit names through i18n
 * keys (`time.unit.minutes`, etc.).
 */

export type DurationUnit = 'second' | 'minute' | 'hour' | 'day';

export interface FormattedDuration {
  value: number;
  unit: DurationUnit;
}

export function formatDuration(ms: number): FormattedDuration {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return { value: sec, unit: 'second' };
  const min = Math.round(sec / 60);
  if (min < 60) return { value: min, unit: 'minute' };
  const hr = Math.round(min / 60);
  if (hr < 48) return { value: hr, unit: 'hour' };
  return { value: Math.round(hr / 24), unit: 'day' };
}
