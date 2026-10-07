import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG, type AuthConfig } from './config.js';

/**
 * Standalone provider — drop into `app.config.ts`:
 *
 *   provideHttpClient(withInterceptors([authInterceptor(), ...apiClientInterceptors()])),
 *   provideAuth({
 *     apiBaseUrl: 'http://localhost:3000/api',
 *     clerkPublishableKey: environment.clerkPublishableKey, // optional
 *   }),
 *
 * With a publishable key the AuthService runs on Clerk; without one it
 * keeps the dev role picker. `apiBaseUrl` scopes where the bearer token is
 * sent and is where the role is read from (`GET /me`).
 */
export function provideAuth(config: AuthConfig = {}): EnvironmentProviders {
  if (config.clerkPublishableKey && !config.apiBaseUrl) {
    throw new Error(
      'provideAuth: apiBaseUrl is required when clerkPublishableKey is set',
    );
  }
  return makeEnvironmentProviders([
    { provide: AUTH_CONFIG, useValue: config },
    AuthService,
    // Construct AuthService at bootstrap (non-blocking) so Clerk starts
    // loading before the first guard asks for the session.
    provideAppInitializer(() => {
      inject(AuthService);
    }),
  ]);
}
