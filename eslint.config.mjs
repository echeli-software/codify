import nx from '@nx/eslint-plugin';
import codify from './tools/eslint-plugin-codify/index.mjs';

/**
 * Shared options for `codify/no-raw-template-text` (docs/11 §11). Project
 * configs pick the severity: 'error' in libs/ui-bootstrap + libs/ui-ionic,
 * 'warn' in apps/admin + apps/student.
 */
export const noRawTemplateTextOptions = {
  // Product / unit names that are never translated.
  allowedText: ['^XP$', '^Codify$', '^PIX$', '^Boleto$'],
};

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    // Local rules: tools/eslint-plugin-codify (unit-tested with RuleTester).
    plugins: { codify },
  },
  {
    // docs/03: every reward mutation goes through RewardOrchestrator.
    // libs/gamification-engine turns this off for itself.
    files: ['**/*.ts'],
    rules: {
      'codify/rewards-through-orchestrator': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          // Every lib resolves to source through tsconfig paths and nothing is
          // published, so the buildable/non-buildable split is not meaningful here.
          enforceBuildableLibDependency: false,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            // Shared Storybook test-runner config (tools/storybook).
            '^.*/tools/storybook/.*$',
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
