import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIonicAngular } from '@ionic/angular/standalone';
import {
  CONTENT_TRANSLATION_SOURCE,
  LOCALE_PERSISTENCE,
  provideI18n,
} from '@codify/i18n';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';
import {
  StudentContentTranslationSource,
  StudentLocalePersistence,
} from './platform/content-translation.source';
import { isNativeRuntime } from './platform/runtime';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      // Order matters: auth first attaches the Bearer token, then the
      // api-client wrapper interceptors layer locale + idempotency +
      // problem-details remapping.
      withInterceptors([authInterceptor(), ...apiClientInterceptors()]),
    ),
    provideIonicAngular({
      // Material mode everywhere — closest to the "native feel" target per
      // docs/05-student-app §1 without per-platform visual drift.
      mode: 'md',
    }),
    provideAuth({
      apiBaseUrl: API_BASE_URL,
      clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    }),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n(),
    // docs/11 §6: persist the chosen locale on the user (PATCH /me).
    { provide: LOCALE_PERSISTENCE, useExisting: StudentLocalePersistence },
    // docs/11 §3: content translations — API online, downloads offline.
    {
      provide: CONTENT_TRANSLATION_SOURCE,
      useExisting: StudentContentTranslationSource,
    },
    // PWA (docs/16 §6): app shell precached by the Angular service worker,
    // wrapped by codify-sw.js which also serves downloaded images offline.
    // Production web builds only — the native shell bundles the app itself.
    provideServiceWorker('codify-sw.js', {
      enabled: !isDevMode() && !isNativeRuntime(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
