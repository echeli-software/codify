import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, type Observable, throwError } from 'rxjs';

/**
 * 429 with a machine-readable code and the number of seconds until the
 * caller may retry (docs/14 §7). `RetryAfterInterceptor` copies it into the
 * `Retry-After` response header.
 */
export class RateLimitedException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSec: number,
    code = 'RATE_LIMITED',
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code,
        message,
        retryAfter: retryAfterSec,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class RetryAfterInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof RateLimitedException) {
          const res = ctx.switchToHttp().getResponse<Response>();
          res.setHeader(
            'Retry-After',
            String(Math.max(1, Math.ceil(err.retryAfterSec))),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}

/**
 * Sliding-window check over timestamps already loaded from the DB: given
 * the `limit` most recent event times (newest first), returns the seconds
 * until a new event is allowed, or 0 when under the limit.
 */
export function retryAfterSeconds(
  recentNewestFirst: Date[],
  limit: number,
  windowMs: number,
  now = Date.now(),
): number {
  if (recentNewestFirst.length < limit) return 0;
  const oldestInWindow = recentNewestFirst[limit - 1];
  const freeAt = oldestInWindow.getTime() + windowMs;
  return freeAt > now ? Math.ceil((freeAt - now) / 1000) : 0;
}
