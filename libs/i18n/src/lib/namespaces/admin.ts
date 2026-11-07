import type { TranslationNamespace } from '../namespace.js';

// One module per app-specific namespace: a bundler only scans the
// `import()`s of modules an app actually imports, so the other app's
// strings are not even emitted as lazy chunks (the package is
// `sideEffects: false`). Import paths must stay literal for splitting.

/** Admin app strings (`admin.*`). */
export const ADMIN_STRINGS: TranslationNamespace = {
  name: 'admin',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/admin.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/admin.json', { with: { type: 'json' } }),
};
