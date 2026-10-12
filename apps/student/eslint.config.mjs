import nx from '@nx/eslint-plugin';
import baseConfig, { noRawTemplateTextOptions } from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    // Capacitor native projects: `cap sync` copies the built web bundle in.
    ignores: ['**/android/**', '**/ios/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['app', 'cdf'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'cdf'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // index.html is served before Angular boots (no translate pipe); its
    // <noscript> fallback is deliberately bilingual.
    ignores: ['**/src/index.html'],
    rules: {
      // docs/11 §11 — every app template string goes through i18n.
      'codify/no-raw-template-text': ['error', noRawTemplateTextOptions],
    },
  },
];
