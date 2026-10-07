import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL } from './api-base-url';
import { appRoutes } from './app.routes';

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
      // Use platform-aware mode (Material on Android, iOS-native on iOS,
      // iOS by default in browser — closest to "native feel" target per
      // docs/05-student-app §1).
      mode: 'md',
    }),
    provideAuth(),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n(),
  ],
};
