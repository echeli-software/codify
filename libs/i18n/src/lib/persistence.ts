import { InjectionToken } from '@angular/core';
import type { Locale } from './locales.js';

/**
 * Optional server-side persistence for the user's locale (docs/11 §6:
 * "Persist user choice on `User.locale` once authenticated"). Apps provide
 * it with a `PATCH /api/me { locale }` call; the LanguageSwitcher
 * molecules (and `I18nService.changeLocale()`) invoke it after switching.
 * Failures are swallowed — the local choice still applies.
 */
export interface LocalePersistence {
  persist(locale: Locale): Promise<unknown> | void;
}

export const LOCALE_PERSISTENCE = new InjectionToken<LocalePersistence>(
  'LOCALE_PERSISTENCE',
);
