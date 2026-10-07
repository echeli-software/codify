/**
 * API origin + global prefix used by `provideApiClient`.
 *
 * Deploy pipelines inject it at build time with Angular's `define` option
 * (see docs/13-deployment.md §9 and .github/workflows/preview.yml):
 *
 *   nx run <app>:build:production --define=CODIFY_API_URL="'https://api.codify.app/api'"
 *
 * Local builds/serves don't define it and fall back to the local API.
 */
declare const CODIFY_API_URL: string | undefined;

export const API_BASE_URL: string =
  typeof CODIFY_API_URL === 'string' && CODIFY_API_URL
    ? CODIFY_API_URL
    : 'http://localhost:3000/api';
