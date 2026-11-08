import { ErrorHandler, type Provider } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { APP_VERSION } from '../api-base-url';
import { setMissingTranslationReporter } from './missing-translation';
import { runtimePlatform } from './runtime';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/**
 * Sentry for the student app. Loaded lazily from `main.ts` and only when
 * the `CODIFY_SENTRY_DSN` build define is set (and, on the web, the user
 * allowed error reporting), so builds without a DSN don't ship the SDK at
 * all. Events are scrubbed of emails / tokens / PII before they leave the
 * device (docs/14 §17). Returns the providers that route Angular's
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
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  // docs/11 §2: missing keys become (rate-limited) Sentry warnings.
  setMissingTranslationReporter((key, locale) =>
    Sentry.captureMessage(`Missing translation: ${key}`, {
      level: 'warning',
      tags: { kind: 'missing_translation', locale },
      fingerprint: ['missing-translation', key],
    }),
  );
  return [
    {
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler({ showDialog: false }),
    },
  ];
}
