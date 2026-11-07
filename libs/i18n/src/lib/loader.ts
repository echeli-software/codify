/**
 * Translation loader for ngx-translate (docs/11 §2).
 *
 * Strings live in one JSON file per namespace and locale. Each app declares
 * the namespaces it renders (`provideI18n({ namespaces: [...] })`) and only
 * those files are fetched — as lazy chunks, for the active locale — so the
 * student app never ships the admin strings in its initial bundle.
 *
 * `I18nService.init()` runs in an app initializer and waits for the active
 * locale's chunks before the first render, so `t()` / `instant()` stay
 * synchronous after boot. Switching locale loads the other locale's chunks
 * before the switch is applied.
 *
 * Namespaces live in ./namespaces/* (one module per app). Tests and
 * Storybook skip the async path with `preloadAllTranslations()` from
 * `@codify/i18n/testing`.
 */

import { Injectable, InjectionToken, inject } from '@angular/core';
import { from, of, type Observable } from 'rxjs';
import type { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.js';
import type { TranslationNamespace } from './namespace.js';
import { SHARED_NAMESPACES } from './namespaces/shared.js';

export type { TranslationNamespace } from './namespace.js';

/** The namespaces `CodifyTranslateLoader` fetches (set by `provideI18n`). */
export const I18N_NAMESPACES = new InjectionToken<
  readonly TranslationNamespace[]
>('I18N_NAMESPACES', {
  providedIn: 'root',
  // Only the shared files by default: an app lists its own namespace
  // (ADMIN_STRINGS / STUDENT_STRINGS …), so the other app's strings are
  // not even emitted as a lazy chunk in its build.
  factory: () => SHARED_NAMESPACES,
});

/**
 * JSON modules arrive as the object itself (bundlers, esModuleInterop) or
 * wrapped in `{ default }` (CommonJS test runners without interop).
 */
export function unwrapJsonModule(mod: object | undefined): object {
  if (!mod) return {};
  return (mod as { default?: object }).default ?? mod;
}

/** Fetches and merges the given namespaces for one locale. */
export async function loadTranslationBundle(
  locale: Locale,
  namespaces: readonly TranslationNamespace[],
): Promise<TranslationObject> {
  const mods = await Promise.all(namespaces.map((ns) => ns.load(locale)));
  return Object.assign({}, ...mods.map(unwrapJsonModule)) as TranslationObject;
}

const preloaded = new Map<Locale, TranslationObject>();

/**
 * Registers ready-made bundles the loader returns synchronously instead of
 * fetching chunks (unit tests, Storybook). Pass `null` to clear.
 */
export function preloadTranslations(
  bundles: Partial<Record<Locale, TranslationObject>> | null,
): void {
  if (!bundles) {
    preloaded.clear();
    return;
  }
  for (const [locale, bundle] of Object.entries(bundles)) {
    if (isLocale(locale) && bundle) preloaded.set(locale, bundle);
  }
}

@Injectable()
export class CodifyTranslateLoader implements TranslateLoader {
  private readonly namespaces = inject(I18N_NAMESPACES);

  getTranslation(lang: string): Observable<TranslationObject> {
    const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;
    const ready = preloaded.get(locale);
    if (ready) return of(ready);
    return from(loadTranslationBundle(locale, this.namespaces));
  }
}
