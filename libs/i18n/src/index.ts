// Public surface of @codify/i18n. See docs/11-i18n.md.

export {
  type Locale,
  type LocaleMeta,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_META,
  isLocale,
  pickLocale,
} from './lib/locales.js';
export { I18nService } from './lib/i18n.service.js';
export { provideI18n, type ProvideI18nOptions } from './lib/provider.js';
export { CodifyTranslateLoader, TRANSLATION_BUNDLES } from './lib/loader.js';
export { CodifyTranslateCompiler } from './lib/compiler.js';
export { compileIcu, formatIcu, type IcuParams } from './lib/icu.js';
export {
  LocalePipe,
  formatForLocale,
  currencyForLocale,
  defaultDateFormat,
  type LocaleFormat,
  type DateStyle,
} from './lib/locale.pipe.js';
export {
  CONTENT_TRANSLATION_SOURCE,
  CONTENT_TRANSLATION_BATCH_SIZE,
  ContentTranslationService,
  type ContentEntityType,
  type ContentTranslationRequest,
  type ContentTranslationBatch,
  type ContentTranslationSource,
  type ContentLookupOptions,
} from './lib/content-translation.js';
export {
  ContentTranslatePipe,
  tContent,
} from './lib/content-translate.pipe.js';
export {
  LOCALE_PERSISTENCE,
  type LocalePersistence,
} from './lib/persistence.js';

// Re-export the ngx-translate template pipe + directive so consumers can
// use `{{ 'common.save' | translate }}` without importing ngx-translate directly.
export {
  TranslatePipe,
  TranslateDirective,
  TranslateService,
} from '@ngx-translate/core';
