import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 503 for a dependency that is temporarily unavailable (LLM grader, a
 * backed-up Judge0 queue): problem `code`, `retryAfter` in the body, and
 * `retryAfterSec` for `RetryAfterInterceptor`, which copies it into the
 * `Retry-After` header. Nothing was recorded or granted — the client may
 * simply resubmit later.
 */
export class RetryLaterException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterSec: number,
  ) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code,
        message,
        retryAfter: retryAfterSec,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
