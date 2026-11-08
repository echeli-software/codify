import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { SHARED_NAMESPACES, provideI18n } from '@codify/i18n';
import { ADMIN_STRINGS } from '@codify/i18n/admin';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';
import { adminTelemetryInterceptor } from './core/telemetry';
import { staffSessionInterceptor } from './core/staff-session';
import {
  ApiContentTranslationSource,
  MeLocalePersistence,
} from './core/i18n-adapters';
import { MissingTranslationHandler } from '@ngx-translate/core';
import { ReportingMissingTranslationHandler } from './core/missing-translation';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([
        authInterceptor(),
        ...apiClientInterceptors(),
        adminTelemetryInterceptor,
        // 403 MFA_REQUIRED / SESSION_TOO_OLD → /reauth (docs/14 §1, §18).
        staffSessionInterceptor,
      ]),
    ),
    provideAuth({
      apiBaseUrl: API_BASE_URL,
      clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    }),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n({
      namespaces: [...SHARED_NAMESPACES, ADMIN_STRINGS],
      contentSource: ApiContentTranslationSource,
      persistence: MeLocalePersistence,
    }),
    // docs/11 §2: missing keys → dev console / rate-limited Sentry warning.
    {
      provide: MissingTranslationHandler,
      useClass: ReportingMissingTranslationHandler,
    },
    // Media upload adapters (LESSON_ASSET_UPLOADER / FILE_UPLOADER /
    // ASSET_LIBRARY) are provided on the lazy shell route — see shell.routes.
  ],
};
