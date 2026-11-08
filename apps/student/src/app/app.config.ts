import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import {
  I18nService,
  LOCALE_PERSISTENCE,
  SHARED_NAMESPACES,
  provideI18n,
} from '@codify/i18n';
import {
  STUDENT_PLATFORM_STRINGS,
  STUDENT_STRINGS,
} from '@codify/i18n/student';
import { authInterceptor, provideAuth } from '@codify/auth';
import {
  SiteConfigClient,
  apiClientInterceptors,
  provideApiClient,
} from '@codify/api-client';
import { applyBrandingVars } from '@codify/ui-core/color';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';
import { provideLazyContentTranslationSource } from './platform/lazy-providers';
import { StudentLocalePersistence } from './platform/locale-persistence';
import { isNativeRuntime } from './platform/runtime';
import { accountStateInterceptor } from './pages/account/account-state';
import { translationFallbackInterceptor } from './platform/translation-fallback.interceptor';
import { TELEMETRY_CONSENT, consentAllows } from './telemetry/consent';
import { MissingTranslationHandler } from '@ngx-translate/core';
import { ReportingMissingTranslationHandler } from './platform/missing-translation';

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
    // Only the string files the student app renders (no admin strings).
    provideI18n({
      namespaces: [
        ...SHARED_NAMESPACES,
        STUDENT_STRINGS,
        STUDENT_PLATFORM_STRINGS,
      ],
    }),
    // docs/11 §2: missing keys → dev console / rate-limited Sentry warning.
    {
      provide: MissingTranslationHandler,
      useClass: ReportingMissingTranslationHandler,
    },
    // docs/14 §13: analytics only after web consent (native: store disclosure).
    { provide: TELEMETRY_CONSENT, useValue: () => consentAllows('analytics') },
    // docs/04 Settings: environment branding colours + enabled locales.
    // Non-blocking: a failed fetch keeps the built-in tokens and locales.
    provideAppInitializer(() => {
      const site = inject(SiteConfigClient);
      const i18n = inject(I18nService);
      void site
        .get()
        .then((c) => {
          if (typeof document !== 'undefined')
            applyBrandingVars(
              document.documentElement.style,
              c.branding.tokens,
            );
          return i18n.restrictLocales(c.locales.enabled);
        })
        .catch(() => undefined);
    }),
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
