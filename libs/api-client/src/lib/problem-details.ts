/**
 * RFC 7807 ProblemDetails — the preferred error shape from the API. NestJS
 * default exception responses are close (`{ statusCode, message, error }`)
 * but not identical. The mapper below normalizes either shape into a
 * typed `ProblemDetailsError` so caller code branches on `status` /
 * `code` instead of stringly-typed message text.
 *
 * The API can later opt into actual RFC 7807 by setting Content-Type to
 * `application/problem+json` and a `type` URI; we'll pick that up
 * automatically without changing call sites.
 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  /** Short machine code, e.g. `user.not_found`, `validation.failed`. */
  code?: string;
  instance?: string;
  /** Field-level validation errors keyed by path. */
  errors?: Record<string, string[]>;
}

export class ProblemDetailsError extends Error {
  readonly status: number;
  readonly title?: string;
  readonly code?: string;
  readonly errors?: Record<string, string[]>;
  readonly type?: string;
  readonly instance?: string;

  constructor(p: ProblemDetails) {
    super(p.detail || p.title || `HTTP ${p.status}`);
    this.name = 'ProblemDetailsError';
    this.status = p.status;
    this.title = p.title;
    this.code = p.code;
    this.errors = p.errors;
    this.type = p.type;
    this.instance = p.instance;
  }

  /** Convenience checks — keep call sites declarative. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Convert anything an HttpErrorResponse / fetch error / Nest JSON body
 * might throw into a stable `ProblemDetailsError`. Robust against
 * partial / malformed shapes — we always return *something*.
 */
export function toProblemDetails(err: unknown): ProblemDetailsError {
  if (err instanceof ProblemDetailsError) return err;

  // Angular's HttpErrorResponse exposes `status` + `error` (the body).
  const e = err as {
    status?: number;
    statusText?: string;
    error?: unknown;
    message?: string;
  };

  const status = typeof e?.status === 'number' && e.status > 0 ? e.status : 0;
  const body = e?.error;

  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    return new ProblemDetailsError({
      status: (b['status'] as number) ?? status,
      title: (b['title'] as string) ?? (b['error'] as string) ?? e?.statusText,
      detail: (b['detail'] as string) ?? (b['message'] as string),
      code: b['code'] as string | undefined,
      type: b['type'] as string | undefined,
      instance: b['instance'] as string | undefined,
      errors: b['errors'] as Record<string, string[]> | undefined,
    });
  }

  return new ProblemDetailsError({
    status,
    title: e?.statusText ?? 'Request failed',
    detail: e?.message,
  });
}
