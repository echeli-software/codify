// @nestjs/bullmq ships ESM-only (this jest config doesn't transform it).
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
  Processor: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
  WorkerHost: class {},
}));

import { BullPushDeferrer } from './bull-push-deferrer.js';
import {
  deferredPushJobId,
  type DeferredPushJobData,
} from './push-deferral.js';
import { PushDeferredProcessor } from './push-deferred.processor.js';
import type { PushService } from './push.service.js';

const job: DeferredPushJobData = {
  userId: 'u1',
  kind: 'LEAGUE_RESULT',
  message: { title: 'T', body: 'B', data: { type: 'league_result' } },
  deliverAt: '2026-10-08T11:00:00.000Z',
};

describe('PushDeferredProcessor', () => {
  it('re-sends through sendToUser at delivery time (caps and quiet hours apply)', async () => {
    const push = {
      sendToUser: jest.fn(async () => ({ status: 'capped', reason: 'daily' })),
    };
    const p = new PushDeferredProcessor(push as unknown as PushService);
    await expect(p.process({ data: job } as never)).resolves.toEqual({
      status: 'capped',
      reason: 'daily',
    });
    expect(push.sendToUser).toHaveBeenCalledWith('u1', job.message, {
      kind: 'LEAGUE_RESULT',
    });
  });
});

describe('BullPushDeferrer', () => {
  it('adds a delayed job that collapses duplicates', async () => {
    const queue = {
      waitUntilReady: jest.fn(async () => undefined),
      add: jest.fn(async () => ({ id: 'j' })),
    };
    const deliverAt = new Date(Date.now() + 60_000);
    await expect(
      new BullPushDeferrer(queue as never).defer(job, deliverAt),
    ).resolves.toBe(true);
    const [, data, opts] = queue.add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId: string; delay: number },
    ];
    expect(data).toBe(job);
    expect(opts.jobId).toBe(deferredPushJobId(job, deliverAt));
    expect(opts.jobId).not.toContain(':');
    expect(opts.delay).toBeGreaterThan(55_000);
    expect(opts.delay).toBeLessThanOrEqual(60_000);
    expect(deferredPushJobId(job, deliverAt)).toBe(
      deferredPushJobId({ ...job }, new Date(deliverAt)),
    );
  });

  it('reports false when Redis is unreachable', async () => {
    const queue = {
      waitUntilReady: jest.fn(() => Promise.reject(new Error('down'))),
      add: jest.fn(),
    };
    await expect(
      new BullPushDeferrer(queue as never).defer(job, new Date()),
    ).resolves.toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
