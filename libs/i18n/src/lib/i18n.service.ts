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

import {
  ContentTranslationService,
  type ContentEntityType,
  type ContentLookupOptions,
} from './content-translation.js';
import { LOCALE_PERSISTENCE } from './persistence.js';

const STORAGE_KEY = 'codify.locale';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly translate = inject(TranslateService);
  private readonly content = inject(ContentTranslationService);
  private readonly persistence = inject(LOCALE_PERSISTENCE, { optional: true });
  private readonly _current = signal<Locale>(DEFAULT_LOCALE);
  private requestSeq = 0;

  /** Current locale. Reactive. */
  readonly currentLocale = this._current.asReadonly();
  /** Locales the environment enables (docs/04 Settings), default all. */
  private readonly _enabled = signal<readonly Locale[]>(SUPPORTED_LOCALES);
  /**
   * Locales for the language switcher: the supported ones the environment
   * has enabled. A getter over a signal, so `computed`s that read it
   * re-evaluate when {@link restrictLocales} changes the set.
   */
  get availableLocales(): readonly LocaleMeta[] {
    return this._enabled().map((c) => LOCALE_META[c]);
  }
  /** Convenience: meta for the current locale. */
  readonly currentMeta = computed(() => LOCALE_META[this._current()]);

  /**
   * Picks the initial locale and loads its strings. Runs in an app
   * initializer: the returned promise resolves once `t()` can translate
   * synchronously (immediately when the strings were preloaded).
   */
  init(): Promise<void> {
    this.translate.addLangs([...SUPPORTED_LOCALES]);
    this.translate.setFallbackLang(DEFAULT_LOCALE);
    const initial = this.detectInitial();
    return this.applyLocale(initial);
  }

  /**
   * Switches locale. The switch (signal, `<html lang>`) is applied once the
   * locale's strings are loaded — synchronously when they already are.
   */
  setLocale(locale: Locale): Promise<void> {
    if (!this._enabled().includes(locale)) return Promise.resolve();
    this.persist(locale);
    return this.applyLocale(locale);
  }

  /**
   * User-initiated switch (LanguageSwitcher): applies the locale locally,
   * then persists it server-side through the optional `LOCALE_PERSISTENCE`.
   * Resolves once the remote save settles; never rejects.
   */
  async changeLocale(locale: Locale): Promise<void> {
    if (!this._enabled().includes(locale)) return;
    await this.setLocale(locale);
    if (!this.persistence) return;
    try {
      await this.persistence.persist(locale);
    } catch {
      // Remote save failed — the local choice (localStorage) still holds.
    }
  }

  /**
   * Limit the switchable locales to `codes` (site settings "locale
   * enable/disable"). Unknown codes are ignored and the default locale is
   * always kept; when the current locale is disabled the app switches to
   * the default.
   */
  restrictLocales(codes: readonly string[]): Promise<void> {
    const enabled = SUPPORTED_LOCALES.filter(
      (l) => l === DEFAULT_LOCALE || codes.includes(l),
    );
    this._enabled.set(enabled);
    return enabled.includes(this._current())
      ? Promise.resolve()
      : this.setLocale(DEFAULT_LOCALE);
  }

  /** Translate a key with optional ICU params. Synchronous instant lookup. */
  t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string;
  }

  /**
   * Content translation for the current locale (docs/03). Signal-backed:
   * call it inside a template / computed and it re-renders once the batch
   * lands. Returns `opts.fallback` (or '') until then / when missing.
   */
  tContent(
    entityType: ContentEntityType,
    entityId: string | null | undefined,
    field: string,
    opts: ContentLookupOptions = {},
  ): string {
    return (
      this.content.translate(
        entityType,
        entityId,
        field,
        opts.locale ?? this._current(),
        opts.fallback ?? null,
      ) ?? ''
    );
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

  private applyLocale(locale: Locale): Promise<void> {
    const request = ++this.requestSeq;
    return new Promise<void>((resolve) => {
      const done = () => {
        // A later setLocale() wins over a slower earlier load.
        if (request === this.requestSeq) this.commitLocale(locale);
        resolve();
      };
      // Emits synchronously when the strings are already loaded.
      this.translate.use(locale).subscribe({
        complete: done,
        error: (err: unknown) => {
          // Keep the current locale (ngx-translate did not switch either).
          console.error(`[i18n] could not load ${locale} strings`, err);
          resolve();
        },
      });
    });
  }

  private commitLocale(locale: Locale): void {
    this._current.set(locale);
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
