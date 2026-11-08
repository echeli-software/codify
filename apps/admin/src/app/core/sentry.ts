import { ErrorHandler, type Provider } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { APP_VERSION } from '../api-base-url';
import { setMissingTranslationReporter } from './missing-translation';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/**
 * Sentry for the admin app (docs/14 §17), same pattern as the student app:
 * loaded lazily from `main.ts` only when the `CODIFY_SENTRY_DSN` build
 * define is set, errors only, and every event scrubbed of emails / tokens /
 * user fields before it is sent. Staff screens show student emails, so the
 * scrubbing matters even more here.
 */
export function initSentry(dsn: string): Provider[] {
  Sentry.init({
    dsn,
    release: `codify-admin@${APP_VERSION}`,
    environment: APP_VERSION === 'dev' ? 'development' : 'production',
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
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
