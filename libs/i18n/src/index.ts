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
export { provideI18n } from './lib/provider.js';
export { CodifyTranslateLoader } from './lib/loader.js';

// Re-export the ngx-translate template pipe + directive so consumers can
// use `{{ 'common.save' | translate }}` without importing ngx-translate directly.
export { TranslatePipe, TranslateDirective, TranslateService } from '@ngx-translate/core';
