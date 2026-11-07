import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import { preloadAllTranslations } from './testing.js';

setupZonelessTestEnv();

// Strings load lazily in the apps; specs get every namespace synchronously
// (loader.spec.ts clears this to exercise the lazy path).
preloadAllTranslations();
