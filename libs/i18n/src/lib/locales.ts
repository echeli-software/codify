/**
 * Supported locales. Adding a new one requires:
 *   1. Add to `SUPPORTED_LOCALES` here.
 *   2. Add JSON files under `libs/i18n/src/strings/<locale>/`.
 *   3. Verify Intl.NumberFormat / RelativeTimeFormat coverage in ui-core.
 *   4. Decide tone (see docs/11-i18n.md §7).
 */

export type Locale = 'pt-BR' | 'en-US';

export const SUPPORTED_LOCALES: readonly Locale[] = ['pt-BR', 'en-US'] as const;

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export interface LocaleMeta {
  code: Locale;
  /** Native-script name (shown in language switcher). */
  nativeName: string;
  /** Suggested currency for new users in this locale. */
  defaultCurrency: 'BRL' | 'USD';
  /** Writing direction. */
  dir: 'ltr' | 'rtl';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  'pt-BR': { code: 'pt-BR', nativeName: 'Português (Brasil)', defaultCurrency: 'BRL', dir: 'ltr' },
  'en-US': { code: 'en-US', nativeName: 'English (US)', defaultCurrency: 'USD', dir: 'ltr' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Pick a supported locale that best matches the user's browser/device locale.
 * Falls back to DEFAULT_LOCALE if nothing matches.
 */
export function pickLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    if (isLocale(candidate)) return candidate;
    // Match the language portion: "pt-PT" → "pt-BR"; "en-GB" → "en-US".
    const lang = candidate.split('-')[0]?.toLowerCase();
    const match = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(lang + '-'));
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
