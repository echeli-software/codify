import { InjectionToken } from '@angular/core';

/**
 * Runtime config for the API client. `baseUrl` is used as the prefix for
 * every request issued through the typed clients. Both apps inject this
 * via `provideApiClient({ baseUrl })` in their app.config.ts so envs
 * (dev / staging / prod) can swap origins without code changes.
 */
export interface ApiClientConfig {
  /** Origin + global prefix, e.g. `http://localhost:3000/api` (no trailing slash). */
  baseUrl: string;
}

export const API_CLIENT_CONFIG = new InjectionToken<ApiClientConfig>(
  '@codify/api-client/CONFIG',
);
