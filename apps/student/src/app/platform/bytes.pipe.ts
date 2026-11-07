import { Pipe, inject, type PipeTransform } from '@angular/core';
import { I18nService } from '@codify/i18n';

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** Bytes → "12.3 MB" / "12,3 MB" in the user's locale. */
export function formatBytes(bytes: number, locale: string): string {
  let v = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: UNITS[i],
      unitDisplay: 'short',
      maximumFractionDigits: i <= 1 ? 0 : 1,
    }).format(v);
  } catch {
    return `${v.toFixed(1)} ${['B', 'KB', 'MB', 'GB'][i]}`;
  }
}

/** `{{ record.totalBytes | bytes }}` — re-renders on locale change. */
@Pipe({ name: 'bytes', pure: false })
export class BytesPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(bytes: number | null | undefined): string {
    return formatBytes(bytes ?? 0, this.i18n.currentLocale());
  }
}
