import { InjectionToken } from '@angular/core';
import { isNativeRuntime } from '../platform/runtime.js';

/**
 * Optional consent gate for TelemetryService: when provided, `track()`
 * drops events while it returns false (app.config provides
 * `() => consentAllows('analytics')`; tests run without it).
 */
export const TELEMETRY_CONSENT = new InjectionToken<() => boolean>(
  'TELEMETRY_CONSENT',
);

/**
 * Web cookie / analytics consent (docs/14 §13 "Banner on first visit (web
 * only) with granular toggles"). Stored locally — never sent anywhere.
 *
 *   necessary  always on: sign-in session, offline data, preferences.
 *   analytics  first-party product analytics (TelemetryService).
 *   errors     crash / error reporting (Sentry).
 *
 * Native apps don't show the banner: the App Store / Play Store privacy
 * disclosure (app privacy "nutrition label" / Data safety form) covers
 * analytics and diagnostics, so both are on there.
 */
export const CONSENT_KEY = 'codify.consent.v1';
/** Bump when the categories change so everyone is asked again. */
export const CONSENT_VERSION = 1;

export type ConsentCategory = 'analytics' | 'errors';

export interface ConsentChoice {
  v: number;
  analytics: boolean;
  errors: boolean;
  /** ISO time of the decision. */
  decidedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readConsent(): ConsentChoice | null {
  try {
    const raw = storage()?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ConsentChoice;
    return c && c.v === CONSENT_VERSION ? c : null;
  } catch {
    return null;
  }
}

export function writeConsent(
  choice: Pick<ConsentChoice, 'analytics' | 'errors'>,
  now = new Date(),
): ConsentChoice {
  const c: ConsentChoice = {
    v: CONSENT_VERSION,
    analytics: !!choice.analytics,
    errors: !!choice.errors,
    decidedAt: now.toISOString(),
  };
  try {
    storage()?.setItem(CONSENT_KEY, JSON.stringify(c));
  } catch {
    // Storage blocked: the choice holds for this page view only.
  }
  return c;
}

/** Whether `category` may run now. Undecided on the web → no. */
export function consentAllows(
  category: ConsentCategory,
  native = isNativeRuntime(),
): boolean {
  if (native) return true;
  return readConsent()?.[category] === true;
}

/** The web banner shows until a choice is stored. */
export function needsConsentBanner(native = isNativeRuntime()): boolean {
  return !native && readConsent() === null;
}
