import {
  type EnvironmentProviders,
  makeEnvironmentProviders,
} from '@angular/core';
import { withInterceptors } from '@angular/common/http';
import { API_CLIENT_CONFIG, type ApiClientConfig } from './api-config.js';
import {
  idempotencyInterceptor,
  localeInterceptor,
  problemDetailsInterceptor,
} from './interceptors.js';

/**
 * Standalone provider for the API client config + the three wrapper-layer
 * interceptors. Use alongside `provideHttpClient(...)` and
 * `authInterceptor()` from `@codify/auth`:
 *
 *   provideHttpClient(
 *     withInterceptors([authInterceptor(), ...apiClientInterceptors()]),
 *   ),
 *   provideApiClient({ baseUrl: 'http://localhost:3000/api' }),
 *
 * The split — config in `provideApiClient`, interceptors via
 * `apiClientInterceptors()` — keeps the two concerns composable so
 * apps can layer their own interceptors in any order without re-providing
 * HttpClient.
 */
export function provideApiClient(
  config: ApiClientConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: API_CLIENT_CONFIG, useValue: config },
  ]);
}

/**
 * Returns the wrapper-layer interceptor list, ready to spread into
 * `withInterceptors([...])`. Order matters: locale + idempotency rewrite
 * the request, problem-details unwraps the response, so mapper must be
 * registered LAST in the array (it sees errors after others).
 */
export function apiClientInterceptors() {
  return [localeInterceptor, idempotencyInterceptor, problemDetailsInterceptor];
}

// `withInterceptors` re-exported so callers can rely on the same Angular
// version the lib was built against.
export { withInterceptors };
