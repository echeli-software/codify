import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Mark a mutating request as idempotent — the interceptor will generate a
 * UUID v4 and attach it as `Idempotency-Key`. The API stores keys in
 * Redis (24h) so the same logical mutation cannot double-apply on retry.
 *
 *   this.http.post('/api/grant', body, {
 *     context: withIdempotency(),
 *   });
 *
 * Default value `false` keeps GET/etc opt-out.
 */
export const IDEMPOTENCY_TOKEN = new HttpContextToken<boolean>(() => false);

/**
 * Returns an `HttpContext` that flips the idempotency flag on. Compose
 * with other context tokens by passing in an existing context.
 */
export function withIdempotency(context?: HttpContext): HttpContext {
  const ctx = context ?? new HttpContext();
  ctx.set(IDEMPOTENCY_TOKEN, true);
  return ctx;
}

/**
 * RFC 4122 v4 UUID generator. Uses `crypto.randomUUID()` when available
 * (every supported browser since 2022 + Node 19+); falls back to a
 * `Math.random()` v4 for SSR / very old environments.
 */
export function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — non-cryptographic, used only if native API is unavailable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
