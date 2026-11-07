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

/**
 * Clerk publishable key (pk_live_… / pk_test_…), injected at build time the
 * same way: `--define=CODIFY_CLERK_PUBLISHABLE_KEY="'pk_…'"`. Unset means
 * the dev role-picker login (only accepted by an API with ALLOW_DEV_AUTH).
 */
declare const CODIFY_CLERK_PUBLISHABLE_KEY: string | undefined;

export const CLERK_PUBLISHABLE_KEY: string | undefined =
  typeof CODIFY_CLERK_PUBLISHABLE_KEY === 'string' &&
  CODIFY_CLERK_PUBLISHABLE_KEY
    ? CODIFY_CLERK_PUBLISHABLE_KEY
    : undefined;

/** Reads a string build define, treating unset/empty as undefined. */
function defined(value: string | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Sentry DSN for the student app (`--define=CODIFY_SENTRY_DSN="'https://…'"`).
 * Unset means Sentry is not initialised at all.
 */
declare const CODIFY_SENTRY_DSN: string | undefined;
export const SENTRY_DSN: string | undefined = defined(
  typeof CODIFY_SENTRY_DSN === 'string' ? CODIFY_SENTRY_DSN : undefined,
);

/**
 * RevenueCat public SDK keys (`appl_…` / `goog_…`), one per store, injected
 * the same way. Unset means native IAP is unavailable in that build.
 */
declare const CODIFY_REVENUECAT_IOS_KEY: string | undefined;
declare const CODIFY_REVENUECAT_ANDROID_KEY: string | undefined;
export const REVENUECAT_IOS_KEY: string | undefined = defined(
  typeof CODIFY_REVENUECAT_IOS_KEY === 'string'
    ? CODIFY_REVENUECAT_IOS_KEY
    : undefined,
);
export const REVENUECAT_ANDROID_KEY: string | undefined = defined(
  typeof CODIFY_REVENUECAT_ANDROID_KEY === 'string'
    ? CODIFY_REVENUECAT_ANDROID_KEY
    : undefined,
);

/**
 * Release identifier reported to analytics + Sentry
 * (`--define=CODIFY_APP_VERSION="'1.4.0+212'"`). Falls back to `dev`.
 */
declare const CODIFY_APP_VERSION: string | undefined;
export const APP_VERSION: string =
  defined(
    typeof CODIFY_APP_VERSION === 'string' ? CODIFY_APP_VERSION : undefined,
  ) ?? 'dev';
