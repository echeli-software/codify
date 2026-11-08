import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/** Response header naming the locale translatable text fell back to. */
export const TRANSLATION_FALLBACK_HEADER = 'X-Translation-Fallback';

/** Per-request content-translation state (docs/11 §3). */
export interface TranslationContext {
  req: Request;
  /** Memoized caller locale (see ContentLocalizer.requestLocale). */
  locale?: Promise<string>;
  /** Locale the first fallen-back text came from; null = none. */
  fallbackFrom: string | null;
}

const storage = new AsyncLocalStorage<TranslationContext>();

/** The current HTTP request's translation context, if any. */
export function currentTranslationContext(): TranslationContext | undefined {
  return storage.getStore();
}

/**
 * Record that some text in the current response was served in `fromLocale`
 * instead of the requested locale. No-op outside an HTTP request (jobs).
 */
export function noteTranslationFallback(fromLocale: string): void {
  const ctx = storage.getStore();
  if (ctx && !ctx.fallbackFrom) ctx.fallbackFrom = fromLocale;
}

/** Run `fn` inside a fresh context (tests). */
export function runInTranslationContext<T>(
  req: Request,
  fn: (ctx: TranslationContext) => T,
): T {
  const ctx: TranslationContext = { req, fallbackFrom: null };
  return storage.run(ctx, () => fn(ctx));
}

/**
 * Global interceptor: gives every HTTP request a translation context and,
 * when any translatable text in a successful response fell back to another
 * locale, sets `X-Translation-Fallback: <fromLocale>` (exposed via CORS in
 * main.ts) so clients can tell the user once.
 */
@Injectable()
export class TranslationFallbackInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ctx: TranslationContext = { req, fallbackFrom: null };
    // Subscribe inside the store so the (deferred) handler and every
    // promise it creates see this request's context.
    return new Observable((subscriber) =>
      storage.run(ctx, () =>
        next
          .handle()
          .pipe(
            tap(() => {
              if (ctx.fallbackFrom && !res.headersSent)
                res.setHeader(TRANSLATION_FALLBACK_HEADER, ctx.fallbackFrom);
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }
}

/**
 * `?fallback=false` on the current request (docs/11 §3 fetch pattern):
 * the caller wants the requested locale or nothing. Default true.
 */
export function requestAllowsFallback(): boolean {
  const q = storage.getStore()?.req?.query as
    | Record<string, unknown>
    | undefined;
  const v = q?.['fallback'];
  return !(typeof v === 'string' && v.trim().toLowerCase() === 'false');
}
