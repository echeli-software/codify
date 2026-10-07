type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Coarse, localized countdown: "2d 4h" / "3h 12m" / "45m" / "30s" via the
 * `student.time.*` keys. `withSeconds` keeps second precision under an hour.
 */
export function formatCountdown(
  ms: number,
  t: Translate,
  withSeconds = false,
): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return t('student.time.daysHours', { d, h });
  if (h > 0) return t('student.time.hoursMinutes', { h, m });
  if (withSeconds)
    return m > 0
      ? t('student.time.minutesSeconds', { m, s: sec })
      : t('student.time.seconds', { s: sec });
  return t('student.time.minutes', { m: Math.max(m, s > 0 ? 1 : 0) });
}
