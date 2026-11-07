import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { LOCALE_PERSISTENCE, provideI18n } from '@codify/i18n';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';
import { provideLazyContentTranslationSource } from './platform/lazy-providers';
import { StudentLocalePersistence } from './platform/locale-persistence';
import { isNativeRuntime } from './platform/runtime';
import { accountStateInterceptor } from './pages/account/account-state';
import { translationFallbackInterceptor } from './platform/translation-fallback.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      // Order matters: auth first attaches the Bearer token, then the
      // api-client wrapper interceptors layer locale + idempotency +
      // problem-details remapping.
      // accountStateInterceptor routes 403 ACCOUNT_DELETED / _SUSPENDED to
      // the restore / suspended screens (docs/14 §13).
      withInterceptors([
        authInterceptor(),
        ...apiClientInterceptors(),
        accountStateInterceptor,
        // docs/11 §3: one-time toast when content falls back to another locale.
        translationFallbackInterceptor,
      ]),
    ),
    // Ionic (mode 'md') is configured by the lazily-loaded IonicRoot
    // (platform/ionic-root.component.ts), not here — keeps @ionic/* out of
    // the initial bundle.
    provideAuth({
      apiBaseUrl: API_BASE_URL,
      clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    }),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n(),
    // docs/11 §6: persist the chosen locale on the user (PATCH /me).
    { provide: LOCALE_PERSISTENCE, useExisting: StudentLocalePersistence },
    // docs/11 §3: content translations — API online, downloads offline.
    provideLazyContentTranslationSource(),
    // PWA (docs/16 §6): app shell precached by the Angular service worker,
    // wrapped by codify-sw.js which also serves downloaded images offline.
    // Production web builds only — the native shell bundles the app itself.
    provideServiceWorker('codify-sw.js', {
      enabled: !isDevMode() && !isNativeRuntime(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
