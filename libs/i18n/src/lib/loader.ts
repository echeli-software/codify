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

import ptCommon from '../strings/pt-BR/common.json' with { type: 'json' };
import ptGamification from '../strings/pt-BR/gamification.json' with { type: 'json' };
import ptTime from '../strings/pt-BR/time.json' with { type: 'json' };
import ptBilling from '../strings/pt-BR/billing.json' with { type: 'json' };

function mergeAll(...objs: object[]): TranslationObject {
  return Object.assign({}, ...objs) as TranslationObject;
}

const BUNDLES: Record<Locale, TranslationObject> = {
  'en-US': mergeAll(enCommon, enGamification, enTime, enBilling),
  'pt-BR': mergeAll(ptCommon, ptGamification, ptTime, ptBilling),
};

export class CodifyTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    const bundle = BUNDLES[lang as Locale] ?? BUNDLES['pt-BR'];
    return of(bundle);
  }
}
