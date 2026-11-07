// Secondary entry point `@codify/i18n/testing` (unit tests, Storybook).
// Kept out of the main entry: its static JSON imports would otherwise pull
// every string file into the apps' initial bundles.

import { preloadTranslations } from './lib/loader.js';
import type { TranslationNamespace } from './lib/namespace.js';
import { ADMIN_STRINGS } from './lib/namespaces/admin.js';
import { SHARED_NAMESPACES } from './lib/namespaces/shared.js';
import {
  STUDENT_PLATFORM_STRINGS,
  STUDENT_STRINGS,
} from './lib/namespaces/student.js';
import { staticTranslationBundles } from './lib/static-bundles.js';

export { staticTranslationBundles } from './lib/static-bundles.js';

/** Makes every namespace available synchronously (no lazy chunk loading). */
export function preloadAllTranslations(): void {
  preloadTranslations(staticTranslationBundles());
}

/** Every namespace (key-parity checks, tools) — not a runtime default. */
export function allNamespaces(): readonly TranslationNamespace[] {
  return [
    ...SHARED_NAMESPACES,
    ADMIN_STRINGS,
    STUDENT_STRINGS,
    STUDENT_PLATFORM_STRINGS,
  ];
}
