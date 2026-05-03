/**
 * Bootstrap provider for app config:
 *
 *   import { provideI18n } from '@codify/i18n';
 *   bootstrapApplication(App, { providers: [provideI18n()] });
 *
 * Initializes ngx-translate with the static loader, registers our locales,
 * and runs `I18nService.init()` once the injector is ready.
 */

import {
  inject,
  provideAppInitializer,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  TranslateLoader,
  TranslateModule,
  type TranslateModuleConfig,
} from '@ngx-translate/core';
import { CodifyTranslateLoader } from './loader.js';
import { I18nService } from './i18n.service.js';
import { DEFAULT_LOCALE } from './locales.js';

export function provideI18n(): (Provider | EnvironmentProviders)[] {
  const config: TranslateModuleConfig = {
    loader: { provide: TranslateLoader, useClass: CodifyTranslateLoader },
    fallbackLang: DEFAULT_LOCALE,
    lang: DEFAULT_LOCALE,
  };
  return [
    ...TranslateModule.forRoot(config).providers!,
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
