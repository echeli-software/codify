import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { I18nService } from '@codify/i18n';
import { IDEMPOTENCY_KEY, IDEMPOTENCY_TOKEN, uuidV4 } from './idempotency.js';
import { toProblemDetails } from './problem-details.js';

/**
 * Stamps `Accept-Language` from `I18nService.currentLocale()` onto every
 * outgoing request. The API echoes content translations based on this
 * header, and emails / push notifications inherit the same locale.
 */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  const i18n = inject(I18nService);
  const locale = i18n.currentLocale();
  const cloned = req.clone({
    setHeaders: { 'Accept-Language': locale },
  });
  return next(cloned);
};

/**
 * Generates an `Idempotency-Key` (UUID v4) for any request whose context
 * has IDEMPOTENCY_TOKEN flipped via `withIdempotency()`. The API
 * dedupes on this key so retries on flaky networks don't double-apply.
 */
export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.context.get(IDEMPOTENCY_TOKEN)) return next(req);
  const explicit = req.context.get(IDEMPOTENCY_KEY);
  const cloned = req.clone({
    setHeaders: { 'Idempotency-Key': explicit ?? uuidV4() },
  });
  return next(cloned);
};

/**
 * Catches HTTP errors and remaps them into `ProblemDetailsError` so
 * caller code branches on `.status` / `.code` instead of poking at
 * stringly-typed message text. Non-error responses pass through.
 */
export const problemDetailsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(catchError((err) => throwError(() => toProblemDetails(err))));
