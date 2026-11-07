/**
 * Every namespace, statically imported and merged per locale — for unit
 * tests, Storybook and key-parity checks only. Apps load strings lazily
 * through `CodifyTranslateLoader`; because this is a function (not a
 * top-level constant), bundlers drop it and its JSON imports when unused.
 *
 *   preloadTranslations(staticTranslationBundles()); // test-setup.ts
 */

import type { TranslationObject } from '@ngx-translate/core';
import type { Locale } from './locales.js';
import { unwrapJsonModule } from './loader.js';

import enCommon from '../strings/en-US/common.json' with { type: 'json' };
import enGamification from '../strings/en-US/gamification.json' with { type: 'json' };
import enTime from '../strings/en-US/time.json' with { type: 'json' };
import enBilling from '../strings/en-US/billing.json' with { type: 'json' };
import enUi from '../strings/en-US/ui.json' with { type: 'json' };
import enAdmin from '../strings/en-US/admin.json' with { type: 'json' };
import enStudent from '../strings/en-US/student.json' with { type: 'json' };
import enStudentPlatform from '../strings/en-US/student-platform.json' with { type: 'json' };

import ptCommon from '../strings/pt-BR/common.json' with { type: 'json' };
import ptGamification from '../strings/pt-BR/gamification.json' with { type: 'json' };
import ptTime from '../strings/pt-BR/time.json' with { type: 'json' };
import ptBilling from '../strings/pt-BR/billing.json' with { type: 'json' };
import ptUi from '../strings/pt-BR/ui.json' with { type: 'json' };
import ptAdmin from '../strings/pt-BR/admin.json' with { type: 'json' };
import ptStudent from '../strings/pt-BR/student.json' with { type: 'json' };
import ptStudentPlatform from '../strings/pt-BR/student-platform.json' with { type: 'json' };

function mergeAll(...objs: object[]): TranslationObject {
  return Object.assign({}, ...objs.map(unwrapJsonModule)) as TranslationObject;
}

/** All namespaces merged per locale. */
export function staticTranslationBundles(): Record<Locale, TranslationObject> {
  return {
    'en-US': mergeAll(
      enCommon,
      enGamification,
      enTime,
      enBilling,
      enUi,
      enAdmin,
      enStudent,
      enStudentPlatform,
    ),
    'pt-BR': mergeAll(
      ptCommon,
      ptGamification,
      ptTime,
      ptBilling,
      ptUi,
      ptAdmin,
      ptStudent,
      ptStudentPlatform,
    ),
  };
}
