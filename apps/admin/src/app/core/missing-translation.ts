import { Injectable, isDevMode } from '@angular/core';
import {
  MissingTranslationHandler,
  type MissingTranslationHandlerParams,
} from '@ngx-translate/core';

/**
 * Missing-translation reporting (docs/11 §2): in dev every missing key is
 * logged once; in production each key is reported to Sentry once per
 * session (at most MAX_REPORTS per session), through the reporter the lazy
 * Sentry chunk registers. Without Sentry nothing is sent. The key itself is
 * still rendered, as ngx-translate does by default.
 */
export type MissingTranslationReporter = (key: string, locale: string) => void;

export const MAX_REPORTS = 20;

let reporter: MissingTranslationReporter | null = null;
const seen = new Set<string>();

export function setMissingTranslationReporter(
  fn: MissingTranslationReporter | null,
): void {
  reporter = fn;
}

/** Test helper. */
export function resetMissingTranslations(): void {
  seen.clear();
  reporter = null;
}

export function noteMissingTranslation(
  key: string,
  locale: string,
  dev = isDevMode(),
): void {
  const id = `${locale}:${key}`;
  if (seen.has(id)) return;
  if (seen.size >= MAX_REPORTS && !dev) return;
  seen.add(id);
  if (dev) {
    console.warn(`[i18n] missing translation "${key}" (${locale})`);
    return;
  }
  try {
    reporter?.(key, locale);
  } catch {
    /* reporting must never break rendering */
  }
}

@Injectable()
export class ReportingMissingTranslationHandler extends MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    const locale = params.translateService.getCurrentLang() || 'unknown';
    noteMissingTranslation(params.key, locale);
    return params.key;
  }
}
