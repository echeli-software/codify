import type { ExecutionContext } from '@nestjs/common';

// @nestjs/bullmq ships ESM only; the decorator is irrelevant here.
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));
import { RetryLaterException } from '../common/retry-later.js';
import {
  BullCodeBacklog,
  CodeQueueGuard,
  backlogRetryAfter,
  codeBacklogPolicyFromEnv,
} from './judge0-backlog.js';

function ctx() {
  const headers: Record<string, string> = {};
  const c = {
    switchToHttp: () => ({
      getResponse: () => ({
        setHeader: (k: string, v: string) => (headers[k] = v),
      }),
    }),
  } as unknown as ExecutionContext;
  return { c, headers };
}

const policy = { maxBacklog: 100, concurrency: 4 };

describe('CodeQueueGuard', () => {
  it('lets runs through below the backlog limit or when depth is unknown', async () => {
    for (const depth of [0, 99, null]) {
      const g = new CodeQueueGuard({ depth: async () => depth }, policy);
      await expect(g.canActivate(ctx().c)).resolves.toBe(true);
    }
  });

  it('answers 503 CODE_QUEUE_BUSY + Retry-After at or over the limit', async () => {
    const g = new CodeQueueGuard({ depth: async () => 140 }, policy);
    const { c, headers } = ctx();
    const err = await g.canActivate(c).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RetryLaterException);
    const ex = err as RetryLaterException;
    expect(ex.getStatus()).toBe(503);
    expect(ex.getResponse()).toMatchObject({ code: 'CODE_QUEUE_BUSY' });
    expect(headers['Retry-After']).toBe(String(ex.retryAfterSec));
    expect(ex.retryAfterSec).toBe(backlogRetryAfter(140, policy));
  });

  it('is disabled with CODE_QUEUE_MAX_BACKLOG=0', async () => {
    const g = new CodeQueueGuard(
      { depth: async () => 10_000 },
      { maxBacklog: 0, concurrency: 4 },
    );
    await expect(g.canActivate(ctx().c)).resolves.toBe(true);
  });
});

describe('backlog policy', () => {
  it('parses env with defaults and rejects garbage', () => {
    expect(codeBacklogPolicyFromEnv({})).toEqual({
      maxBacklog: 100,
      concurrency: 4,
    });
    expect(
      codeBacklogPolicyFromEnv({
        CODE_QUEUE_MAX_BACKLOG: '20',
        SUBMISSION_WORKER_CONCURRENCY: '8',
      }),
    ).toEqual({ maxBacklog: 20, concurrency: 8 });
    expect(() =>
      codeBacklogPolicyFromEnv({ CODE_QUEUE_MAX_BACKLOG: '-1' }),
    ).toThrow(/CODE_QUEUE_MAX_BACKLOG/);
  });

  it('retry-after grows with the excess and stays within 5–60 s', () => {
    expect(backlogRetryAfter(100, policy)).toBe(6);
    expect(backlogRetryAfter(140, policy)).toBe(16);
    expect(backlogRetryAfter(10_000, policy)).toBe(60);
  });
});

describe('BullCodeBacklog', () => {
  it('reads the waiting count, or null when Redis is unreachable', async () => {
    const up = new BullCodeBacklog({
      waitUntilReady: async () => undefined,
      getWaitingCount: async () => 7,
    } as never);
    expect(await up.depth()).toBe(7);
    const down = new BullCodeBacklog({
      waitUntilReady: () => Promise.reject(new Error('ECONNREFUSED')),
      getWaitingCount: async () => 7,
    } as never);
    expect(await down.depth()).toBeNull();
  });
});
