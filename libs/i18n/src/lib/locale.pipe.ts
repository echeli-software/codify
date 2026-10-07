/**
 * `LocalePipe` — formats dates, numbers and money with the *current*
 * locale from `I18nService`, re-rendering when the user switches language.
 *
 *   {{ 1234.5 | locale }}                         → "1.234,5"  (pt-BR)
 *   {{ 3990 | locale: 'currency' : 'BRL' }}       → "R$ 39,90" (cents in)
 *   {{ 0.42 | locale: 'percent' }}                → "42%"
 *   {{ 12345 | locale: 'compact' }}               → "12,3 mil"
 *   {{ createdAt | locale: 'date' }}              → "7 de out. de 2026"
 *   {{ createdAt | locale: 'date' : 'long' }}     → "7 de outubro de 2026"
 *   {{ createdAt | locale: 'datetime' }}
 *   {{ createdAt | locale: 'time' }}
 *   {{ createdAt | locale: 'relative' }}          → "há 5 minutos"
 *
 * Impure (re-evaluates on locale change) but memoised on
 * (value, format, arg, locale) so change detection stays cheap.
 */

import { Pipe, inject, type PipeTransform } from '@angular/core';
import { formatCompact, formatCurrency, formatRelative } from '@codify/ui-core';
import { I18nService } from './i18n.service.js';
import { LOCALE_META, type Locale } from './locales.js';

export type LocaleFormat =
  | 'number'
  | 'integer'
  | 'percent'
  | 'compact'
  | 'currency'
  | 'date'
  | 'time'
  | 'datetime'
  | 'relative';

export type DateStyle = 'short' | 'medium' | 'long' | 'full';

type DateInput = Date | string | number;

/** Pure formatting function behind the pipe — usable from TS too. */
export function formatForLocale(
  value: unknown,
  locale: Locale | string,
  format: LocaleFormat = 'number',
  arg?: string,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (format) {
    case 'number':
    case 'integer':
    case 'percent':
    case 'compact': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return '';
      if (format === 'compact') return formatCompact(n, locale);
      if (format === 'percent')
        return new Intl.NumberFormat(locale, {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(n);
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: format === 'integer' ? 0 : 2,
      }).format(n);
    }
    case 'currency': {
      const cents = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(cents)) return '';
      const currency = arg ?? currencyForLocale(locale);
      return formatCurrency(cents, currency, locale);
    }
    case 'date':
    case 'time':
    case 'datetime':
    case 'relative': {
      const d = toDate(value as DateInput);
      if (!d) return '';
      if (format === 'relative') return formatRelative(d, locale, now);
      const style = (arg as DateStyle | undefined) ?? 'medium';
      const opts: Intl.DateTimeFormatOptions =
        format === 'date'
          ? { dateStyle: style }
          : format === 'time'
            ? { timeStyle: style === 'medium' ? 'short' : style }
            : { dateStyle: style, timeStyle: 'short' };
      return new Intl.DateTimeFormat(locale, opts).format(d);
    }
    default:
      return String(value);
  }
}

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Suggested currency for a locale (docs/03 `currencyForLocale`). */
export function currencyForLocale(locale: string): 'BRL' | 'USD' {
  const meta = LOCALE_META[locale as Locale];
  if (meta) return meta.defaultCurrency;
  return locale.toLowerCase().startsWith('pt') ? 'BRL' : 'USD';
}

/** `Intl` date-style default per locale (docs/03 `defaultDateFormat`). */
export function defaultDateFormat(locale: string): Intl.DateTimeFormatOptions {
  return locale.startsWith('en')
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
}

@Pipe({ name: 'locale', pure: false })
export class LocalePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  private lastKey: unknown[] | null = null;
  private lastValue = '';

  transform(value: unknown, format: LocaleFormat = 'number', arg?: string) {
    const locale = this.i18n.currentLocale();
    // Relative dates drift with the clock — never memoise them.
    const key = [value, format, arg, locale];
    if (
      format !== 'relative' &&
      this.lastKey &&
      key.every((k, i) => Object.is(k, this.lastKey![i]))
    ) {
      return this.lastValue;
    }
    this.lastKey = key;
    this.lastValue = formatForLocale(value, locale, format, arg);
    return this.lastValue;
  }
}
