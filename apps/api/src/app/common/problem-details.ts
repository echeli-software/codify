import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * RFC 7807 problem+json body as the API emits it. Matches what
 * `toProblemDetails()` in libs/api-client parses: `status`, `title`,
 * `detail` (string), `code`, `type`, `instance`, `errors` (field → messages).
 * Any extra fields an HttpException carried (e.g. `progress`/`totals` on the
 * lesson-complete 409, `requiredPlans`/`reason` on the 402 paywall) are kept
 * at the top level — the client bundles them under `ProblemDetailsError.data`.
 */
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  instance?: string;
  requestId: string;
  errors?: Record<string, string[]>;
  [extra: string]: unknown;
}

export interface ProblemOptions {
  requestId: string;
  instance?: string;
  /** Production hides internal error messages on 5xx. */
  production: boolean;
}

export interface BuiltProblem {
  status: number;
  body: ProblemBody;
  /** True for 5xx — log at error level + report to Sentry. */
  unexpected: boolean;
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'auth.unauthenticated',
  402: 'payment_required',
  403: 'auth.forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal',
  502: 'bad_gateway',
  503: 'unavailable',
  504: 'gateway_timeout',
};

/** Keys of a Nest exception body that map onto standard problem fields. */
const MAPPED_KEYS = new Set([
  'statusCode',
  'status',
  'message',
  'error',
  'title',
  'detail',
  'code',
  'type',
  'instance',
  'errors',
  'requestId',
]);

function defaultCode(status: number): string {
  return DEFAULT_CODES[status] ?? (status >= 500 ? 'internal' : 'error');
}

function statusTitle(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

function isPrismaKnownError(
  err: unknown,
): err is { code: string; message: string; meta?: unknown } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return true;
  // Driver-adapter builds can surface a structurally identical error from a
  // different module instance — fall back to a duck-type check.
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'PrismaClientKnownRequestError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

function asStringRecord(v: unknown): Record<string, string[]> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) out[k] = val.map(String);
    else if (typeof val === 'string') out[k] = [val];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Turn anything thrown by a handler into a problem+json response. */
export function buildProblem(
  exception: unknown,
  opts: ProblemOptions,
): BuiltProblem {
  const base = (status: number): ProblemBody => ({
    type: 'about:blank',
    title: statusTitle(status),
    status,
    code: defaultCode(status),
    instance: opts.instance,
    requestId: opts.requestId,
  });

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = base(status);
    const response = exception.getResponse();
    if (typeof response === 'string') {
      body.detail = response;
    } else if (response && typeof response === 'object') {
      const r = response as Record<string, unknown>;
      const message = r['message'];
      if (typeof r['detail'] === 'string') body.detail = r['detail'];
      else if (typeof message === 'string') body.detail = message;
      else if (Array.isArray(message))
        body.detail = message.map(String).join('; ');
      if (typeof r['title'] === 'string') body.title = r['title'];
      if (typeof r['code'] === 'string') body.code = r['code'];
      if (typeof r['type'] === 'string') body.type = r['type'];
      const errors = asStringRecord(r['errors']);
      if (errors) body.errors = errors;
      for (const [k, v] of Object.entries(r)) {
        if (!MAPPED_KEYS.has(k)) body[k] = v;
      }
    }
    if (!body.detail) body.detail = exception.message;
    return finish(body, status >= 500, opts, exception);
  }

  if (isPrismaKnownError(exception)) {
    switch (exception.code) {
      case 'P2025':
        return finish(
          { ...base(404), detail: 'Record not found', code: 'not_found' },
          false,
          opts,
          exception,
        );
      case 'P2002':
        return finish(
          {
            ...base(409),
            detail: 'A record with these values already exists',
            code: 'conflict.unique',
          },
          false,
          opts,
          exception,
        );
      case 'P2003':
        return finish(
          {
            ...base(400),
            detail: 'A referenced record does not exist',
            code: 'invalid_reference',
          },
          false,
          opts,
          exception,
        );
    }
  }

  // http-errors style (body-parser: malformed JSON, payload too large…).
  if (exception && typeof exception === 'object') {
    const e = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      message?: unknown;
    };
    const status =
      typeof e.status === 'number'
        ? e.status
        : typeof e.statusCode === 'number'
          ? e.statusCode
          : 0;
    if (status >= 400 && status < 500 && e.expose === true) {
      const body = base(status);
      if (typeof e.message === 'string') body.detail = e.message;
      return finish(body, false, opts, exception);
    }
  }

  return finish(base(500), true, opts, exception, true);
}

function finish(
  body: ProblemBody,
  unexpected: boolean,
  opts: ProblemOptions,
  exception: unknown,
  hideInternals = false,
): BuiltProblem {
  if (hideInternals) {
    // Never leak internals in production; dev keeps the message (never the
    // stack) to speed up debugging.
    body.detail =
      !opts.production && exception instanceof Error && exception.message
        ? exception.message
        : 'Internal server error';
  }
  return { status: body.status, body, unexpected };
}
