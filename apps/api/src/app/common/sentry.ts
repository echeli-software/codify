import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.schema.js';

const SCRUBBED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'svix-signature',
  'stripe-signature',
];

/**
 * Initialise Sentry when `SENTRY_DSN` is set. Errors only by default
 * (`SENTRY_TRACES_SAMPLE_RATE` opts into tracing). PII is scrubbed in
 * `beforeSend` per docs/14 §17: no auth headers, cookies, bodies, IPs or
 * emails — the user is identified by internal id only.
 */
export function initSentry(env: Env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    beforeSend: (event) => scrubEvent(event),
  });
  return true;
}

export function scrubEvent<
  T extends {
    request?: {
      headers?: Record<string, string>;
      data?: unknown;
      cookies?: unknown;
    };
    user?: { id?: string | number; email?: string; ip_address?: string | null };
  },
>(event: T): T {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SCRUBBED_HEADERS.includes(key.toLowerCase())) delete headers[key];
    }
  }
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
  }
  if (event.user) {
    event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  }
  return event;
}

export interface ExceptionContext {
  requestId?: string;
  userId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** Report an exception to Sentry (no-op when Sentry isn't initialised). */
export function reportException(
  err: unknown,
  ctx: ExceptionContext = {},
): void {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag('request_id', ctx.requestId);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    for (const [k, v] of Object.entries(ctx.tags ?? {})) scope.setTag(k, v);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureException(err);
  });
}

/** Report a non-exception condition (e.g. ledger drift) to Sentry. */
export function reportMessage(
  message: string,
  ctx: ExceptionContext & { level?: 'warning' | 'error' } = {},
): void {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(ctx.tags ?? {})) scope.setTag(k, v);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureMessage(message, ctx.level ?? 'warning');
  });
}

/** Flush pending events (used on shutdown). */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (Sentry.isInitialized()) await Sentry.flush(timeoutMs);
}
