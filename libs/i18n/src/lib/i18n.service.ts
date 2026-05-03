/**
 * I18nService — the canonical app-facing locale state. Wraps ngx-translate
 * and adds:
 *   - signals for `currentLocale` and `availableLocales`
 *   - localStorage persistence (Phase 1; server-sync via User.locale comes in Phase 4)
 *   - automatic <html lang/dir> updates
 *   - browser/device locale detection on first run
 *
 * Use `provideI18n()` (from ./provider) in your app config to wire it.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  SUPPORTED_LOCALES,
  isLocale,
  pickLocale,
  type Locale,
  type LocaleMeta,
} from './locales.js';

const STORAGE_KEY = 'codify.locale';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly translate = inject(TranslateService);
  private readonly _current = signal<Locale>(DEFAULT_LOCALE);

  /** Current locale. Reactive. */
  readonly currentLocale = this._current.asReadonly();
  /** Read-only list of supported locales for the language switcher. */
  readonly availableLocales: readonly LocaleMeta[] = SUPPORTED_LOCALES.map((c) => LOCALE_META[c]);
  /** Convenience: meta for the current locale. */
  readonly currentMeta = computed(() => LOCALE_META[this._current()]);

  init(): void {
    this.translate.addLangs([...SUPPORTED_LOCALES]);
    this.translate.setFallbackLang(DEFAULT_LOCALE);
    const initial = this.detectInitial();
    this.applyLocale(initial);
  }

  setLocale(locale: Locale): void {
    if (!SUPPORTED_LOCALES.includes(locale)) return;
    this.applyLocale(locale);
    this.persist(locale);
  }

  /** Translate a key with optional ICU params. Synchronous instant lookup. */
  t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string;
  }

  /**
   * Detect the initial locale: prefer the persisted value, then browser/device,
   * then DEFAULT_LOCALE.
   */
  private detectInitial(): Locale {
    const persisted = this.readPersisted();
    if (persisted) return persisted;
    const candidates: string[] = [];
    if (typeof navigator !== 'undefined') {
      if (navigator.languages?.length) candidates.push(...navigator.languages);
      if (navigator.language) candidates.push(navigator.language);
    }
    return pickLocale(candidates);
  }

  private applyLocale(locale: Locale): void {
    this._current.set(locale);
    this.translate.use(locale);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.setAttribute('dir', LOCALE_META[locale].dir);
    }
  }

  private persist(locale: Locale): void {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Private browsing / disabled storage — fine, just won't persist.
    }
  }

  private readPersisted(): Locale | null {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return isLocale(v) ? v : null;
    } catch {
      return null;
    }
  }
}
