import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideIonicAngular({
      // Use platform-aware mode (Material on Android, iOS-native on iOS,
      // iOS by default in browser — closest to "native feel" target per
      // docs/05-student-app §1).
      mode: 'md',
    }),
    provideI18n(),
  ],
};
