import { Injectable, inject } from '@angular/core';
import { I18nService } from '@codify/i18n';
import { ToastService } from '@codify/ui-bootstrap';
import { ProblemDetailsError, toProblemDetails } from '@codify/api-client';

/**
 * Problem `code`s (RFC 7807 bodies from the API) that have a dedicated,
 * translated message under `admin.errors.code.<CODE>`. Anything else falls
 * back to a status-based message, plus the API's own `detail` where it adds
 * information (validation, permission caps, conflicts).
 */
export const KNOWN_ERROR_CODES = [
  'ASSET_TYPE_NOT_ALLOWED',
  'ASSET_TOO_LARGE',
  'ASSET_NOT_UPLOADED',
  'ASSET_CONTENT_MISMATCH',
  'ENROLLMENT_GRANTED',
  'INVALID_RUBRIC',
  'INVALID_SCENARIO',
  'INVALID_TESTS',
  'LANGUAGE_NOT_SUPPORTED',
  'RUNNER_UNAVAILABLE',
  'IDEMPOTENCY_KEY_REUSED',
  'conflict.unique',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/** Translation key + params + API detail resolved for one error. */
export interface ResolvedError {
  key: string;
  /** API-supplied detail worth showing next to the translated message. */
  detail: string | null;
  status: number;
  code: string | null;
}

/** Generic API detail strings that add nothing over the translated message. */
const GENERIC_DETAIL =
  /^(forbidden resource|forbidden|unauthorized|not found|internal server error|http \d{3}.*|request failed)$/i;

function usefulDetail(p: ProblemDetailsError): string | null {
  const d = p.message?.trim();
  if (!d || GENERIC_DETAIL.test(d)) return null;
  if (p.title && d === p.title) return null;
  return d;
}

/**
 * Pure mapping from any thrown value (ProblemDetailsError, HttpErrorResponse,
 * Error, …) to the translation key that describes it. `fallbackKey` names
 * the operation that failed ("admin.errors.saveFailed").
 */
export function resolveError(err: unknown, fallbackKey: string): ResolvedError {
  if (
    !(err instanceof ProblemDetailsError) &&
    !(err && typeof err === 'object' && 'status' in err)
  ) {
    return { key: fallbackKey, detail: null, status: 0, code: null };
  }
  const p = toProblemDetails(err);
  const code = p.code ?? null;
  const base = { status: p.status, code };
  if (code && (KNOWN_ERROR_CODES as readonly string[]).includes(code)) {
    // Rubric / scenario / test validation lists the concrete problems.
    const withDetail =
      code === 'INVALID_RUBRIC' ||
      code === 'INVALID_SCENARIO' ||
      code === 'INVALID_TESTS';
    return {
      key: `admin.errors.code.${code}`,
      detail: withDetail ? usefulDetail(p) : null,
      ...base,
    };
  }
  if (p.status === 0)
    return { key: 'admin.errors.network', detail: null, ...base };
  if (p.status === 401)
    return { key: 'admin.errors.unauthorized', detail: null, ...base };
  if (p.status === 403)
    return { key: 'admin.errors.forbidden', detail: usefulDetail(p), ...base };
  if (p.status === 404)
    return { key: 'admin.errors.notFound', detail: usefulDetail(p), ...base };
  if (p.status === 409)
    return { key: 'admin.errors.conflict', detail: usefulDetail(p), ...base };
  if (p.status === 413)
    return { key: 'admin.errors.code.ASSET_TOO_LARGE', detail: null, ...base };
  if (p.status === 429)
    return { key: 'admin.errors.rateLimited', detail: null, ...base };
  if (p.status === 400 || p.status === 422)
    return { key: 'admin.errors.validation', detail: usefulDetail(p), ...base };
  if (p.status >= 500)
    return { key: 'admin.errors.server', detail: null, ...base };
  return { key: fallbackKey, detail: usefulDetail(p), ...base };
}

/** Compose the user-facing string from a resolved error. */
export function formatResolvedError(
  r: ResolvedError,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const message = t(r.key);
  return r.detail
    ? t('admin.errors.withDetail', { message, detail: r.detail })
    : message;
}

/**
 * The one error-to-message helper for the admin app. Pages call
 * `errors.message(err, 'admin.errors.saveFailed')` for inline errors or
 * `errors.toast(err, …)` to raise a toast.
 */
@Injectable({ providedIn: 'root' })
export class AdminErrors {
  private readonly i18n = inject(I18nService);
  private readonly toasts = inject(ToastService);

  message(err: unknown, fallbackKey = 'admin.errors.generic'): string {
    return formatResolvedError(resolveError(err, fallbackKey), (k, p) =>
      this.i18n.t(k, p),
    );
  }

  toast(err: unknown, fallbackKey = 'admin.errors.generic'): void {
    this.toasts.error(this.message(err, fallbackKey));
  }
}

/** `issues` from a 400 on lesson content (`lessonDocSchema` failures). */
export interface ContentIssue {
  path: string;
  code: string;
  message: string;
}

export function contentIssuesOf(err: unknown): ContentIssue[] {
  if (!err || typeof err !== 'object') return [];
  const p = toProblemDetails(err);
  const raw = p.data?.['issues'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({
      path: String(i['path'] ?? ''),
      code: String(i['code'] ?? ''),
      message: String(i['message'] ?? ''),
    }));
}

/**
 * Individual problems from an `INVALID_RUBRIC` / `INVALID_SCENARIO` /
 * `INVALID_TESTS` body. The API joins them in `detail` ("Invalid rubric: a;
 * b"); a structured `errors` array is used when present.
 */
export function validationProblemsOf(err: unknown, code: string): string[] {
  if (!err || typeof err !== 'object') return [];
  const p = toProblemDetails(err);
  if (p.code !== code) return [];
  const structured = (p.errors as unknown) ?? p.data?.['errors'];
  if (Array.isArray(structured)) return structured.map(String);
  const detail = p.message ?? '';
  const colon = detail.indexOf(':');
  const list = colon >= 0 ? detail.slice(colon + 1) : detail;
  return list
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
