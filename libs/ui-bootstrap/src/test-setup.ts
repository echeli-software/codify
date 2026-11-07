import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import { preloadAllTranslations } from '@codify/i18n/testing';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

// Strings load lazily in the apps; specs get every namespace synchronously.
preloadAllTranslations();
