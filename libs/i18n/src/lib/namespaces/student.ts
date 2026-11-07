import type { TranslationNamespace } from '../namespace.js';

// One module per app-specific namespace: a bundler only scans the
// `import()`s of modules an app actually imports, so the other app's
// strings are not even emitted as lazy chunks (the package is
// `sideEffects: false`). Import paths must stay literal for splitting.

/** Student app strings (`student.*`, `studentPlatform.*`). */
export const STUDENT_STRINGS: TranslationNamespace = {
  name: 'student',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/student.json', { with: { type: 'json' } })
      : import('../../strings/pt-BR/student.json', { with: { type: 'json' } }),
};
export const STUDENT_PLATFORM_STRINGS: TranslationNamespace = {
  name: 'studentPlatform',
  load: (l) =>
    l === 'en-US'
      ? import('../../strings/en-US/student-platform.json', {
          with: { type: 'json' },
        })
      : import('../../strings/pt-BR/student-platform.json', {
          with: { type: 'json' },
        }),
};
