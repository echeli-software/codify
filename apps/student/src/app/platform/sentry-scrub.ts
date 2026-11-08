/**
 * PII scrubbing for frontend Sentry events (docs/14 §17): no emails, no
 * tokens, no user fields beyond the internal id, no request bodies or
 * cookies, no auth headers, no secrets in URL query strings. Pure (no SDK
 * import) so it ships in the lazy Sentry chunk and is unit-testable.
 * Keep in sync with the other app's copy (apps/admin/src/app/core,
 * apps/student/src/app/platform).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** JWTs (Clerk session tokens) and bearer credentials. */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Long opaque keys (Stripe / Clerk / RevenueCat style `sk_…`, `pk_…`). */
const API_KEY = /\b(?:sk|pk|rk|whsec|appl|goog)_[A-Za-z0-9_]{12,}\b/g;

const SENSITIVE_PARAM =
  /^(?:token|access_token|id_token|refresh_token|code|state|key|secret|password|email|session|sig|signature|__clerk[\w-]*|__session|_clerk[\w-]*)$/i;

const SENSITIVE_HEADER =
  /^(?:authorization|cookie|set-cookie|x-api-key|idempotency-key)$/i;

/** Replace emails / tokens in free text. */
export function scrubText(text: string): string {
  return text
    .replace(JWT, '[token]')
    .replace(BEARER, '$1 [token]')
    .replace(API_KEY, '[key]')
    .replace(EMAIL, '[email]');
}

/** Drop sensitive query parameters (and fragments) from a URL string. */
export function scrubUrl(url: string): string {
  const hashless = url.split('#')[0] ?? url;
  const q = hashless.indexOf('?');
  if (q < 0) return scrubText(hashless);
  const base = hashless.slice(0, q);
  const params = hashless
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [k] = pair.split('=');
      return SENSITIVE_PARAM.test(decodeURIComponent(k ?? ''))
        ? `${k}=[filtered]`
        : pair;
    });
  return scrubText(params.length ? `${base}?${params.join('&')}` : base);
}

type Json = unknown;

function scrubDeep(value: Json, depth = 0): Json {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      if (/email|token|password|secret|authorization|cookie/i.test(k))
        out[k] = '[filtered]';
      else out[k] = scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Minimal structural view of a Sentry event (no SDK types needed). */
export interface ScrubbableEvent {
  message?: string;
  user?: { id?: string | number; [k: string]: unknown } | null;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
  };
  exception?: { values?: { value?: string; type?: string }[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

export interface ScrubbableBreadcrumb {
  message?: string;
  category?: string;
  data?: Record<string, unknown>;
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T {
  if (crumb.message) crumb.message = scrubText(crumb.message);
  if (crumb.data) {
    const data = { ...crumb.data };
    for (const k of ['url', 'to', 'from']) {
      if (typeof data[k] === 'string') data[k] = scrubUrl(data[k] as string);
    }
    crumb.data = scrubDeep(data) as Record<string, unknown>;
  }
  return crumb;
}

/** `beforeSend`: scrub an event in place and return it. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = scrubText(event.message);
  if (event.user) {
    event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    const headers = event.request.headers;
    if (headers) {
      for (const k of Object.keys(headers))
        if (SENSITIVE_HEADER.test(k)) delete headers[k];
    }
  }
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  if (event.breadcrumbs)
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.extra)
    event.extra = scrubDeep(event.extra) as Record<string, unknown>;
  if (event.contexts)
    event.contexts = scrubDeep(event.contexts) as Record<string, unknown>;
  if (event.tags) event.tags = scrubDeep(event.tags) as Record<string, unknown>;
  return event;
}
