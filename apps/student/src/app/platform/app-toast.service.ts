import { Injectable, signal } from '@angular/core';
import { ProblemDetailsError, toProblemDetails } from '@codify/api-client';

export type AppToastKind = 'info' | 'success' | 'warning' | 'error';

export interface AppToastAction {
  /** Translation key (or literal) for the action button label. */
  label: string;
  handler: () => void;
}

export interface AppToastOptions {
  /**
   * Translation key (e.g. `studentPlatform.errors.network`) or an already
   * localized string — the host runs it through the translate pipe, which
   * returns unknown keys unchanged.
   */
  message: string;
  kind: AppToastKind;
  /** Auto-dismiss after this many ms; 0 keeps it until dismissed. */
  durationMs?: number;
  /** ICU params for `message`. */
  params?: Record<string, unknown>;
  action?: AppToastAction;
}

export interface AppToast extends Required<Omit<AppToastOptions, 'action'>> {
  id: number;
  action?: AppToastAction;
}

const DEFAULT_DURATION: Record<AppToastKind, number> = {
  info: 4000,
  success: 3500,
  warning: 6000,
  error: 6000,
};
/** Oldest toasts fall off beyond this many on screen. */
const MAX_VISIBLE = 3;

/**
 * App-wide transient messages (docs/05 §errors). Rendered by
 * `<cdf-app-toast-host>` (mounted once in the root component):
 *
 *   toast.show({ message: 'studentPlatform.downloads.removed', kind: 'success' });
 *   toast.error(err); // maps the problem `code` / status to a translated key
 */
@Injectable({ providedIn: 'root' })
export class AppToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _toasts = signal<AppToast[]>([]);
  /** Visible toasts, oldest first. */
  readonly toasts = this._toasts.asReadonly();

  show(opts: AppToastOptions): number {
    const id = ++this.seq;
    const toast: AppToast = {
      id,
      message: opts.message,
      kind: opts.kind,
      durationMs: opts.durationMs ?? DEFAULT_DURATION[opts.kind],
      params: opts.params ?? {},
      action: opts.action,
    };
    this._toasts.update((list) => {
      const next = [...list, toast];
      for (const dropped of next.slice(
        0,
        Math.max(0, next.length - MAX_VISIBLE),
      )) {
        this.clearTimer(dropped.id);
      }
      return next.slice(-MAX_VISIBLE);
    });
    if (toast.durationMs > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), toast.durationMs),
      );
    }
    return id;
  }

  /** Show the translated message for an API / runtime error. */
  error(
    err: unknown,
    opts: Partial<Omit<AppToastOptions, 'kind'>> = {},
  ): number {
    return this.show({
      ...opts,
      message: opts.message ?? errorMessageKey(err),
      kind: 'error',
    });
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    for (const id of this.timers.keys()) this.clearTimer(id);
    this._toasts.set([]);
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }
}

/**
 * Problem `code` → translation key. Codes come from the API's
 * problem+json bodies (see apps/api … `code:`); unknown codes fall back to
 * the HTTP status mapping below.
 */
const CODE_KEYS: Record<string, string> = {
  LESSON_ALREADY_COMPLETED: 'alreadyCompleted',
  LESSON_COMPLETES_VIA_OWN_FLOW: 'completesViaOwnFlow',
  QUIZ_REQUIRES_GRADING: 'quizRequiresGrading',
  QUIZ_ATTEMPT_COOLDOWN: 'quizCooldown',
  NO_ATTEMPTS_LEFT: 'noAttemptsLeft',
  NO_QUIZ: 'notFound',
  AI_SUBMIT_COOLDOWN: 'aiCooldown',
  AI_RATE_LIMIT_MINUTE: 'aiRateLimit',
  AI_RATE_LIMIT_DAY: 'aiRateLimitDay',
  RUNNER_UNAVAILABLE: 'runnerUnavailable',
  CLIENT_TIMESTAMP_TOO_OLD: 'clientTimestamp',
  CLIENT_TIMESTAMP_IN_FUTURE: 'clientTimestamp',
  INVALID_CLIENT_TIMESTAMP: 'clientTimestamp',
  ENROLLMENT_GRANTED: 'enrollmentGranted',
  IDEMPOTENCY_KEY_REUSED: 'conflict',
  'device.rebind_required': 'deviceRebind',
  'conflict.unique': 'conflict',
  'validation.failed': 'validation',
  payment_required: 'paywall',
  not_found: 'notFound',
};

const STATUS_KEYS: [test: (s: number) => boolean, key: string][] = [
  [(s) => s === 0, 'network'],
  [(s) => s === 400 || s === 422, 'validation'],
  [(s) => s === 401, 'unauthorized'],
  [(s) => s === 402, 'paywall'],
  [(s) => s === 403, 'forbidden'],
  [(s) => s === 404, 'notFound'],
  [(s) => s === 409, 'conflict'],
  [(s) => s === 413, 'tooLarge'],
  [(s) => s === 429, 'rateLimited'],
  [(s) => s === 503, 'unavailable'],
  [(s) => s >= 500, 'server'],
];

/**
 * Map any thrown value (ProblemDetailsError, HttpErrorResponse, Error) to a
 * `studentPlatform.errors.*` translation key. Never throws.
 */
export function errorMessageKey(err: unknown): string {
  const prefix = 'studentPlatform.errors.';
  try {
    if (
      !(err instanceof ProblemDetailsError) &&
      !(err && typeof err === 'object' && 'status' in err)
    ) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return `${prefix}network`;
      }
      return `${prefix}unknown`;
    }
    const p = toProblemDetails(err);
    if (p.code && CODE_KEYS[p.code]) return prefix + CODE_KEYS[p.code];
    for (const [test, key] of STATUS_KEYS)
      if (test(p.status)) return prefix + key;
    return `${prefix}unknown`;
  } catch {
    return `${prefix}unknown`;
  }
}
