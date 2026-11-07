import { Logger, ServiceUnavailableException } from '@nestjs/common';

// @nestjs/bullmq ships ESM-only (this jest config doesn't transform it):
// stub the decorators/base class so the processor + enqueuer load.
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
  Processor: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
  WorkerHost: class {},
}));
jest.mock('../common/sentry.js', () => ({ reportException: jest.fn() }));

import { reportException } from '../common/sentry.js';
import { DevBillingProvider } from './billing.provider.js';
import { BullWebhookEnqueuer } from './bull-webhook-enqueuer.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';
import { makeWebhookService } from './testing/fake-billing-deps.js';
import {
  WEBHOOK_JOB_ATTEMPTS,
  onWebhookJobFailed,
  webhookJobId,
  type WebhookEnqueuer,
} from './webhook-queue.js';
import { WebhookProcessor } from './webhook.processor.js';
import type { WebhookService } from './webhook.service.js';

const event = (id = 'evt_q1') => ({
  id,
  type: 'customer.subscription.created',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'sub_q',
      customer: 'cus_q',
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
      metadata: { userId: 'user-1', planId: 'plan-1' },
    },
  },
});

function setup(enqueuer: WebhookEnqueuer) {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1' });
  prisma.state.plans.push({ id: 'plan-1', deletedAt: null });
  const { svc } = makeWebhookService(
    prisma,
    new DevBillingProvider('test-secret'),
    { enqueuer },
  );
  const send = (e: unknown) =>
    svc.handleStripe(Buffer.from(JSON.stringify(e)), e, undefined);
  return { prisma, svc, send };
}

describe('WebhookService — queue hand-off (docs/09 §6 steps 4–5)', () => {
  const env = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = env;
  });

  it('enqueues the verified event and returns 200 without processing', async () => {
    const enqueue = jest.fn(async () => true);
    const { prisma, send } = setup({ enqueue });
    await expect(send(event())).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: false,
      queued: true,
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_q1' }),
    );
    expect(prisma.transactions).toBe(0);
    expect(prisma.state.subscriptions).toHaveLength(0);
  });

  it('a replay of an applied event is a fast duplicate (never re-enqueued)', async () => {
    const enqueue = jest.fn(async () => true);
    const { prisma, svc, send } = setup({ enqueue });
    await svc.processEvent(event()); // what the worker does
    expect(prisma.state.subscriptions).toHaveLength(1);
    await expect(send(event())).resolves.toMatchObject({ duplicate: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('the worker path claims + applies, and a redelivered job is a duplicate', async () => {
    const { prisma, svc } = setup({ enqueue: async () => true });
    await expect(svc.processEvent(event())).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: true,
    });
    await expect(svc.processEvent(event())).resolves.toMatchObject({
      duplicate: true,
    });
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('dev without Redis falls back to inline processing', async () => {
    process.env['NODE_ENV'] = 'development';
    const { prisma, send } = setup({ enqueue: async () => false });
    await expect(send(event())).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: true,
    });
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('production without a reachable queue answers 503 so Stripe retries', async () => {
    process.env['NODE_ENV'] = 'production';
    const { prisma, send } = setup({ enqueue: async () => false });
    await expect(send(event())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.state.idempotency.size).toBe(0);
  });
});

describe('BullWebhookEnqueuer', () => {
  const queue = (ready = true) => ({
    waitUntilReady: jest.fn(() =>
      ready ? Promise.resolve() : Promise.reject(new Error('down')),
    ),
    add: jest.fn(async () => ({ id: 'job' })),
  });

  it('adds a deduplicated job with 5 attempts and exponential backoff', async () => {
    const q = queue();
    const enq = new BullWebhookEnqueuer(q as never);
    const e = event('evt_abc');
    await expect(enq.enqueue(e)).resolves.toBe(true);
    expect(q.add).toHaveBeenCalledWith(
      'stripe.event',
      { event: e },
      expect.objectContaining({
        jobId: 'stripe-evt_abc',
        attempts: WEBHOOK_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
    expect(WEBHOOK_JOB_ATTEMPTS).toBe(5);
  });

  it('reports false when Redis is unreachable or add throws', async () => {
    await expect(
      new BullWebhookEnqueuer(queue(false) as never).enqueue(event()),
    ).resolves.toBe(false);
    const q = queue();
    q.add.mockRejectedValueOnce(new Error('READONLY'));
    await expect(
      new BullWebhookEnqueuer(q as never).enqueue(event()),
    ).resolves.toBe(false);
  });

  it('job ids are valid BullMQ custom ids (no single ":")', () => {
    const id = webhookJobId('evt_1NXyz');
    expect(id).toBe('stripe-evt_1NXyz');
    expect(id.includes(':')).toBe(false);
  });
});

describe('WebhookProcessor', () => {
  const log = { warn: jest.fn(), error: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs the in-transaction claim + process for the job', async () => {
    const processEvent = jest.fn(async () => ({
      received: true,
      duplicate: false,
      handled: true,
    }));
    const p = new WebhookProcessor({
      processEvent,
    } as unknown as WebhookService);
    const e = event();
    await expect(p.process({ data: { event: e } } as never)).resolves.toEqual(
      expect.objectContaining({ handled: true }),
    );
    expect(processEvent).toHaveBeenCalledWith(e);
  });

  it('a non-final failure is logged and retried, not reported', () => {
    const final = onWebhookJobFailed(
      {
        id: 'stripe-evt_1',
        attemptsMade: 2,
        opts: { attempts: 5 },
        data: { event: event('evt_1') },
      },
      new Error('db hiccup'),
      log,
    );
    expect(final).toBe(false);
    expect(log.warn).toHaveBeenCalled();
    expect(reportException).not.toHaveBeenCalled();
  });

  it('the final failure is logged and reported to Sentry with the event id/type', () => {
    const err = new Error('still broken');
    const final = onWebhookJobFailed(
      {
        id: 'stripe-evt_1',
        attemptsMade: 5,
        opts: { attempts: 5 },
        data: { event: event('evt_1') },
      },
      err,
      log,
    );
    expect(final).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('customer.subscription.created evt_1'),
      err.stack,
    );
    expect(reportException).toHaveBeenCalledWith(err, {
      tags: {
        job: 'billing-webhook',
        stripe_event_id: 'evt_1',
        stripe_event_type: 'customer.subscription.created',
      },
      extra: { jobId: 'stripe-evt_1', attemptsMade: 5 },
    });
  });

  it('the processor wires its failed hook to the final-failure reporting', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const p = new WebhookProcessor({} as WebhookService);
    p.onFailed(
      {
        id: 'stripe-evt_9',
        attemptsMade: 5,
        opts: { attempts: 5 },
        data: { event: event('evt_9') },
      } as never,
      new Error('boom'),
    );
    expect(reportException).toHaveBeenCalledTimes(1);
  });
});
