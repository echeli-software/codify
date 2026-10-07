/**
 * Bootstrap provider for app config:
 *
 *   import { provideI18n } from '@codify/i18n';
 *   bootstrapApplication(App, { providers: [provideI18n()] });
 *
 * Initializes ngx-translate with the static loader + ICU-lite compiler,
 * registers our locales, and runs `I18nService.init()` once the injector
 * is ready. Optional hooks:
 *
 *   provideI18n({
 *     contentSource: ApiContentTranslationSource,   // GET /api/translations
 *     persistence: MeLocalePersistence,              // PATCH /api/me
 *   })
 *
 * (equivalently, provide `CONTENT_TRANSLATION_SOURCE` / `LOCALE_PERSISTENCE`
 * yourself).
 */

import {
  inject,
  provideAppInitializer,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import {
  TranslateCompiler,
  TranslateLoader,
  TranslateModule,
  type TranslateModuleConfig,
} from '@ngx-translate/core';
import { CodifyTranslateCompiler } from './compiler.js';
import {
  CONTENT_TRANSLATION_SOURCE,
  type ContentTranslationSource,
} from './content-translation.js';
import { CodifyTranslateLoader } from './loader.js';
import { I18nService } from './i18n.service.js';
import { DEFAULT_LOCALE } from './locales.js';
import { LOCALE_PERSISTENCE, type LocalePersistence } from './persistence.js';

export interface ProvideI18nOptions {
  /** Backs `tContent` / `ContentTranslatePipe` (docs/11 §3). */
  contentSource?: Type<ContentTranslationSource>;
  /** Called by LanguageSwitchers after a user-initiated switch. */
  persistence?: Type<LocalePersistence>;
}

export function provideI18n(
  opts: ProvideI18nOptions = {},
): (Provider | EnvironmentProviders)[] {
  const config: TranslateModuleConfig = {
    loader: { provide: TranslateLoader, useClass: CodifyTranslateLoader },
    compiler: { provide: TranslateCompiler, useClass: CodifyTranslateCompiler },
    fallbackLang: DEFAULT_LOCALE,
    lang: DEFAULT_LOCALE,
  };
  const extra: Provider[] = [];
  if (opts.contentSource) {
    extra.push({
      provide: CONTENT_TRANSLATION_SOURCE,
      useClass: opts.contentSource,
    });
  }
  if (opts.persistence) {
    extra.push({ provide: LOCALE_PERSISTENCE, useClass: opts.persistence });
  }
  return [
    ...TranslateModule.forRoot(config).providers!,
    ...extra,
    provideAppInitializer(() => {
      inject(I18nService).init();
    }),
    provideEnvironmentInitializer(() => {
      // Touch the service so DI eager-creates it (services are providedIn: 'root',
      // but appInitializer might run before any consumer triggers creation).
      inject(I18nService);
    }),
  ];
}
