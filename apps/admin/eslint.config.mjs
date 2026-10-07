import nx from '@nx/eslint-plugin';
import baseConfig, { noRawTemplateTextOptions } from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          // `cdf-` for app-local shared widgets that mirror the design-system
          // naming (e.g. the lazy Monaco `cdf-code-editor`).
          prefix: ['app', 'cdf'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      // docs/11 §11 — warn while the app pages are being translated.
      'codify/no-raw-template-text': ['warn', noRawTemplateTextOptions],
    },
  },
];
