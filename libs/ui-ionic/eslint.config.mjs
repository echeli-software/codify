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
          prefix: ['cdf'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['cdf'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Storybook-only demo components use an `sb-` prefix so they can't be
    // mistaken for library components.
    files: ['**/*.stories.ts'],
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['cdf', 'sb'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // docs/11 §11 — library templates never ship raw user-visible text.
    files: ['**/*.html'],
    rules: {
      'codify/no-raw-template-text': ['error', noRawTemplateTextOptions],
    },
  },
  {
    // Storybook demo hosts (`sb-*`) render sample content, not product UI.
    // Test hosts in specs likewise render fixtures.
    files: ['**/*.stories.ts/*.html', '**/*.spec.ts/*.html'],
    rules: { 'codify/no-raw-template-text': 'off' },
  },
];
