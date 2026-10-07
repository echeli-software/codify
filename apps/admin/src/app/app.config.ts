import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideI18n } from '@codify/i18n';
import { authInterceptor, provideAuth } from '@codify/auth';
import { apiClientInterceptors, provideApiClient } from '@codify/api-client';
import { API_BASE_URL, CLERK_PUBLISHABLE_KEY } from './api-base-url';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(
      withInterceptors([authInterceptor(), ...apiClientInterceptors()]),
    ),
    provideAuth({
      apiBaseUrl: API_BASE_URL,
      clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    }),
    provideApiClient({ baseUrl: API_BASE_URL }),
    provideI18n(),
  ],
};
