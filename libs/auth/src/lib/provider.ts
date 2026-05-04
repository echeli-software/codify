import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { AuthService } from './auth.service.js';

/**
 * Standalone provider function — drop into `app.config.ts`:
 *
 *   import { provideAuth } from '@codify/auth';
 *
 *   export const appConfig: ApplicationConfig = {
 *     providers: [
 *       provideAuth(),
 *       provideHttpClient(withInterceptors([authInterceptor()])),
 *       ...
 *     ],
 *   };
 *
 * Today this is a thin shim — `AuthService` is already `providedIn: 'root'`.
 * The function exists so that Phase 4b can swap in Clerk SDK initialization
 * without changing the call site.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // AuthService is providedIn:'root', listed here for explicitness so
    // Phase 4b can attach Clerk hooks via constructor side-effects.
    AuthService,
  ]);
}
