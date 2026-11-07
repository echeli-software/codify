import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The engine owns the reward state services — it is the one place
    // allowed to mutate them.
    files: ['**/*.ts'],
    rules: { 'codify/rewards-through-orchestrator': 'off' },
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
