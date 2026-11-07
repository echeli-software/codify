import { ErrorHandler, type Provider } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { APP_VERSION } from '../api-base-url.js';
import { runtimePlatform } from './runtime.js';

/**
 * Sentry for the student app. Loaded lazily from `main.ts` and only when
 * the `CODIFY_SENTRY_DSN` build define is set, so builds without a DSN
 * don't ship the SDK at all. Returns the providers that route Angular's
 * ErrorHandler to Sentry.
 */
export function initSentry(dsn: string): Provider[] {
  Sentry.init({
    dsn,
    release: `codify-student@${APP_VERSION}`,
    environment: APP_VERSION === 'dev' ? 'development' : 'production',
    // Errors only; no performance tracing / session replay by default.
    tracesSampleRate: 0,
    initialScope: { tags: { platform: runtimePlatform() } },
  });
  return [
    {
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler({ showDialog: false }),
    },
  ];
}
