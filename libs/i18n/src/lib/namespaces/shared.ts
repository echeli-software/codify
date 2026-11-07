import type { TranslationNamespace } from '../namespace.js';

// One module per app-specific namespace: a bundler only scans the
// `import()`s of modules an app actually imports, so the other app's
// strings are not even emitted as lazy chunks (the package is
// `sideEffects: false`). Import paths must stay literal for splitting.

export const COMMON_STRINGS: TranslationNamespace = {
  name: 'common',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/common.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/common.json', { with: { type: 'json' } }),
};
export const GAMIFICATION_STRINGS: TranslationNamespace = {
  name: 'gamification',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/gamification.json', {
          with: { type: 'json' },
        })
      : import('../../strings/pt-BR/gamification.json', {
          with: { type: 'json' },
        }),
};
export const TIME_STRINGS: TranslationNamespace = {
  name: 'time',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/time.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/time.json', { with: { type: 'json' } }),
};
export const BILLING_STRINGS: TranslationNamespace = {
  name: 'billing',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/billing.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/billing.json', { with: { type: 'json' } }),
};
export const UI_STRINGS: TranslationNamespace = {
  name: 'ui',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/ui.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/ui.json', { with: { type: 'json' } }),
};

/** Namespaces every app needs (shared UI libraries, formatting, billing errors). */
export const SHARED_NAMESPACES: readonly TranslationNamespace[] = [
  COMMON_STRINGS,
  GAMIFICATION_STRINGS,
  TIME_STRINGS,
  BILLING_STRINGS,
  UI_STRINGS,
];
