import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { RetryAfterInterceptor } from '../exercises/rate-limit.js';
import { RetryLaterException } from './retry-later.js';

describe('RetryLaterException', () => {
  it('is a 503 problem with code + retryAfter, and RetryAfterInterceptor sets Retry-After', async () => {
    const err = new RetryLaterException('CODE_QUEUE_BUSY', 'busy', 12.2);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({
      code: 'CODE_QUEUE_BUSY',
      retryAfter: 12.2,
    });
    const setHeader = jest.fn();
    const ctx = {
      switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => throwError(() => err) };
    await expect(
      lastValueFrom(new RetryAfterInterceptor().intercept(ctx, next)),
    ).rejects.toBe(err);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '13');
  });
});
