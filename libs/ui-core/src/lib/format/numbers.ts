/** Formatting helpers for in-game counters. Locale-aware via Intl.NumberFormat. */

export function formatXp(value: number, locale: string): string {
  if (!Number.isFinite(value)) value = 0;
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

export function formatCoins(value: number, locale: string): string {
  if (!Number.isFinite(value)) value = 0;
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

/**
 * Compact thousands rendering for tight UI (leaderboard rows, small chips).
 *   12_345  → "12.3K" (en) / "12,3 mil" (pt)
 */
export function formatCompact(value: number, locale: string): string {
  if (!Number.isFinite(value)) value = 0;
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format a multiplier for display. 2 → "2x"; 1.5 → "1.5x". */
export function formatMultiplier(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return '1x';
  const rounded = Math.round(value * 100) / 100;
  const isWhole = Number.isInteger(rounded);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(rounded);
  return `${formatted}x`;
}
