import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideI18n } from '@codify/i18n';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';
import {
  ApiContentTranslationSource,
  MeLocalePersistence,
} from './core/i18n-adapters';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([authInterceptor(), ...apiClientInterceptors()]),
    ),
    provideAuth({
      apiBaseUrl: API_BASE_URL,
      clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    }),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n({
      contentSource: ApiContentTranslationSource,
      persistence: MeLocalePersistence,
    }),
    // Media upload adapters (LESSON_ASSET_UPLOADER / FILE_UPLOADER /
    // ASSET_LIBRARY) are provided on the lazy shell route — see shell.routes.
  ],
};
