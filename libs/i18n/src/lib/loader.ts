/**
 * Translation loader for ngx-translate.
 *
 * For Phase 1 we use static imports — the JSON is bundled with the app.
 * Bundle impact is small (~10KB per locale) and avoids an HTTP roundtrip
 * on first paint. When we add more namespaces or non-launch locales, we
 * can switch to per-route lazy chunks via `TranslateLoader` HTTP fetch.
 *
 * Each call merges the namespace files for the requested locale into a
 * single deeply-nested object that ngx-translate consumes.
 */

import { Observable, of } from 'rxjs';
import type { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import type { Locale } from './locales.js';

import enCommon from '../strings/en-US/common.json' with { type: 'json' };
import enGamification from '../strings/en-US/gamification.json' with { type: 'json' };
import enTime from '../strings/en-US/time.json' with { type: 'json' };
import enBilling from '../strings/en-US/billing.json' with { type: 'json' };
import enUi from '../strings/en-US/ui.json' with { type: 'json' };

import ptCommon from '../strings/pt-BR/common.json' with { type: 'json' };
import ptGamification from '../strings/pt-BR/gamification.json' with { type: 'json' };
import ptTime from '../strings/pt-BR/time.json' with { type: 'json' };
import ptBilling from '../strings/pt-BR/billing.json' with { type: 'json' };
import ptUi from '../strings/pt-BR/ui.json' with { type: 'json' };

/**
 * JSON modules arrive as the object itself (bundlers, esModuleInterop) or
 * wrapped in `{ default }` (CommonJS test runners without interop).
 */
function unwrap(mod: object | undefined): object {
  if (!mod) return {};
  return (mod as { default?: object }).default ?? mod;
}

function mergeAll(...objs: object[]): TranslationObject {
  return Object.assign({}, ...objs.map(unwrap)) as TranslationObject;
}

/** Every shared namespace, merged per locale (exported for key-parity tests). */
export const TRANSLATION_BUNDLES: Readonly<Record<Locale, TranslationObject>> =
  {
    'en-US': mergeAll(enCommon, enGamification, enTime, enBilling, enUi),
    'pt-BR': mergeAll(ptCommon, ptGamification, ptTime, ptBilling, ptUi),
  };

export class CodifyTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    const bundle =
      TRANSLATION_BUNDLES[lang as Locale] ?? TRANSLATION_BUNDLES['pt-BR'];
    return of(bundle);
  }
}
