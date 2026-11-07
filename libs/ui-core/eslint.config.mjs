import baseConfig from '../../eslint.config.mjs';

/**
 * ui-core is framework-agnostic (docs/03): no Angular, no Ionic, no DOM.
 * The tsconfig already omits the `dom` lib; these rules make the boundary
 * explicit and fail lint before a type error would surface elsewhere.
 */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'Element',
  'Node',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'getComputedStyle',
  'customElements',
].map((name) => ({
  name,
  message: `@codify/ui-core must stay DOM-free (docs/03) — "${name}" is a browser global.`,
}));

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@angular/*',
                '@ionic/*',
                '@ng-bootstrap/*',
                '@ngx-translate/*',
                '@capacitor/*',
                'zone.js',
              ],
              message:
                '@codify/ui-core is framework-agnostic (docs/03): no Angular/Ionic/Capacitor imports.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
