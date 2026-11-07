import { bootstrapApplication } from '@angular/platform-browser';
import type { Provider } from '@angular/core';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { SENTRY_DSN } from './app/api-base-url';

async function main(): Promise<void> {
  const extra: Provider[] = [];
  if (SENTRY_DSN) {
    // Lazy chunk: builds without a DSN never load the Sentry SDK.
    try {
      const { initSentry } = await import('./app/platform/sentry');
      extra.push(...initSentry(SENTRY_DSN));
    } catch (err) {
      console.error('[sentry] init failed', err);
    }
  }
  await bootstrapApplication(App, {
    ...appConfig,
    providers: [...appConfig.providers, ...extra],
  });
}

main().catch((err) => console.error(err));
