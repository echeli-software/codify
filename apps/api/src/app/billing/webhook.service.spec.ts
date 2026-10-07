import { BadRequestException } from '@nestjs/common';
import {
  DevBillingProvider,
  type BillingProvider,
  type SubscriptionSnapshot,
} from './billing.provider.js';
import { WebhookService } from './webhook.service.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

function setup(
  provider: BillingProvider = new DevBillingProvider('test-secret'),
) {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1' });
  prisma.state.plans.push(
    { id: 'plan-1', deletedAt: null, revenueCatEntitlementId: null },
    { id: 'plan-2', deletedAt: null, revenueCatEntitlementId: null },
  );
  prisma.state.planPrices.push(
    {
      id: 'price-annual',
      planId: 'plan-1',
      period: 'ANNUAL',
      stripePriceId: 'price_A',
    },
    {
      id: 'price-pro',
      planId: 'plan-2',
      period: 'MONTHLY',
      stripePriceId: 'price_PRO',
    },
  );
  const svc = new WebhookService(prisma as never, provider);
  const send = (event: unknown) =>
    svc.handleStripe(Buffer.from(JSON.stringify(event)), event, undefined);
  return { prisma, svc, send };
}

function subEvent(
  id: string,
  type: string,
  object: Record<string, unknown>,
  created?: number,
): Record<string, unknown> {
  return { id, type, ...(created ? { created } : {}), data: { object } };
}

const baseSub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  current_period_start: nowSec(),
  current_period_end: nowSec() + 30 * DAY,
  cancel_at_period_end: false,
  metadata: { userId: 'user-1', planId: 'plan-1' },
  ...over,
});

describe('WebhookService — idempotency', () => {
  it('a delivery that fails mid-processing is NOT recorded, so the retry is applied', async () => {
    const { prisma, send } = setup();
    const evt = subEvent('evt_1', 'customer.subscription.created', baseSub());
    prisma.failNext = {
      op: 'subscription.create',
      error: new Error('db hiccup'),
    };

    await expect(send(evt)).rejects.toThrow('db hiccup');
    expect(prisma.state.idempotency.has('stripe:evt_1')).toBe(false);
    expect(prisma.state.subscriptions).toHaveLength(0);

    // Stripe retries the same event → processed, not "duplicate".
    await expect(send(evt)).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: true,
    });
    expect(prisma.state.idempotency.has('stripe:evt_1')).toBe(true);
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('a successful replay is acknowledged as duplicate without reprocessing', async () => {
    const { prisma, send } = setup();
    const evt = subEvent('evt_1', 'customer.subscription.created', baseSub());
    await send(evt);
    const txBefore = prisma.transactions;
    await expect(send(evt)).resolves.toEqual({
      received: true,
      duplicate: true,
      handled: false,
    });
    expect(prisma.transactions).toBe(txBefore); // fast path, no processing
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('a concurrent duplicate that loses the in-transaction claim is a duplicate', async () => {
    const { prisma, svc } = setup();
    const evt = subEvent(
      'evt_race',
      'customer.subscription.created',
      baseSub(),
    );
    // Simulate the other delivery committing between our fast-path read and claim.
    const realFind = prisma.idempotencyRecord.findUnique;
    (prisma.idempotencyRecord as { findUnique: unknown }).findUnique =
      async () => {
        prisma.state.idempotency.set('stripe:evt_race', {
          key: 'stripe:evt_race',
          scope: 'x',
        });
        return null;
      };
    await expect(
      svc.handleStripe(Buffer.from(JSON.stringify(evt)), evt, undefined),
    ).resolves.toEqual({ received: true, duplicate: true, handled: false });
    (prisma.idempotencyRecord as { findUnique: unknown }).findUnique = realFind;
  });

  it('a unique violation raised by processing itself is a real failure (retried), not a duplicate', async () => {
    const { prisma, send } = setup();
    // Row exists for another subscription id but we inject a P2002 on create.
    const { Prisma } = await import('@prisma/client');
    prisma.failNext = {
      op: 'subscription.create',
      error: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 't',
      }),
    };
    await expect(
      send(subEvent('evt_2', 'customer.subscription.created', baseSub())),
    ).rejects.toThrow();
    expect(prisma.state.idempotency.has('stripe:evt_2')).toBe(false);
  });
});

describe('WebhookService — subscription mirror', () => {
  it('unknown userId in metadata is acked with handled:false (no FK error)', async () => {
    const { prisma, send } = setup();
    const res = await send(
      subEvent(
        'evt_1',
        'customer.subscription.created',
        baseSub({ metadata: { userId: 'ghost', planId: 'plan-1' } }),
      ),
    );
    expect(res.handled).toBe(false);
    expect(prisma.state.subscriptions).toHaveLength(0);
    expect(prisma.state.idempotency.has('stripe:evt_1')).toBe(true);
  });

  it('sets pastDueSince on PAST_DUE and clears it on recovery', async () => {
    const { prisma, send } = setup();
    const t0 = nowSec();
    await send(
      subEvent('evt_1', 'customer.subscription.created', baseSub(), t0 - 100),
    );
    await send(
      subEvent(
        'evt_2',
        'customer.subscription.updated',
        baseSub({ status: 'past_due' }),
        t0 + 10,
      ),
    );
    const row = prisma.state.subscriptions[0];
    expect(row['status']).toBe('PAST_DUE');
    expect((row['pastDueSince'] as Date).getTime()).toBe((t0 + 10) * 1000);

    // A second PAST_DUE update keeps the original start of the episode.
    await send(
      subEvent(
        'evt_3',
        'customer.subscription.updated',
        baseSub({ status: 'past_due' }),
        t0 + 20,
      ),
    );
    expect((row['pastDueSince'] as Date).getTime()).toBe((t0 + 10) * 1000);

    await send(
      subEvent(
        'evt_4',
        'customer.subscription.updated',
        baseSub({ status: 'active' }),
        t0 + 30,
      ),
    );
    expect(row['status']).toBe('ACTIVE');
    expect(row['pastDueSince']).toBeNull();
  });

  it('invoice.payment_failed / invoice.paid toggle PAST_DUE in dev (payload) mode', async () => {
    const { prisma, send } = setup();
    const t0 = nowSec();
    await send(
      subEvent('evt_1', 'customer.subscription.created', baseSub(), t0 - 100),
    );
    await send(
      subEvent(
        'evt_2',
        'invoice.payment_failed',
        { subscription: 'sub_1' },
        t0 + 5,
      ),
    );
    expect(prisma.state.subscriptions[0]['status']).toBe('PAST_DUE');
    expect(prisma.state.subscriptions[0]['pastDueSince']).toBeInstanceOf(Date);
    // The newer API shape: invoice.parent.subscription_details.subscription
    await send(
      subEvent(
        'evt_3',
        'invoice.paid',
        { parent: { subscription_details: { subscription: 'sub_1' } } },
        t0 + 6,
      ),
    );
    expect(prisma.state.subscriptions[0]['status']).toBe('ACTIVE');
    expect(prisma.state.subscriptions[0]['pastDueSince']).toBeNull();
  });

  it('reads the period from subscription items (API ≥ 2025-03) and the plan from the price', async () => {
    const { prisma, send } = setup();
    const end = nowSec() + 30 * DAY;
    await send(
      subEvent('evt_1', 'customer.subscription.created', {
        id: 'sub_items',
        customer: 'cus_1',
        status: 'trialing',
        trial_end: end,
        items: {
          data: [
            {
              current_period_start: nowSec(),
              current_period_end: end,
              price: { id: 'price_PRO' },
            },
          ],
        },
        metadata: { userId: 'user-1', planId: 'plan-1' },
      }),
    );
    const row = prisma.state.subscriptions[0];
    expect(row['planId']).toBe('plan-2'); // price wins over (stale) metadata
    expect(row['status']).toBe('TRIALING');
    expect((row['currentPeriodEnd'] as Date).getTime()).toBe(end * 1000);
  });

  it('customer.subscription.deleted closes the access window', async () => {
    const { prisma, send } = setup();
    await send(
      subEvent(
        'evt_1',
        'customer.subscription.created',
        baseSub({ cancel_at_period_end: true }),
      ),
    );
    const endedAt = nowSec();
    await send(
      subEvent(
        'evt_2',
        'customer.subscription.deleted',
        baseSub({
          status: 'canceled',
          ended_at: endedAt,
          cancel_at_period_end: true,
        }),
      ),
    );
    const row = prisma.state.subscriptions[0];
    expect(row['status']).toBe('CANCELED');
    expect((row['currentPeriodEnd'] as Date).getTime()).toBe(endedAt * 1000);
  });
});

describe('WebhookService — ordering', () => {
  it('payload mode: an event created before the row last changed is skipped', async () => {
    const { prisma, send } = setup();
    const t0 = nowSec();
    await send(
      subEvent(
        'evt_new',
        'customer.subscription.created',
        baseSub({ cancel_at_period_end: true }),
        t0,
      ),
    );
    // An older "updated" (cancel_at_period_end=false) delivered late.
    const res = await send(
      subEvent(
        'evt_old',
        'customer.subscription.updated',
        baseSub({ cancel_at_period_end: false }),
        t0 - 3600,
      ),
    );
    expect(res.handled).toBe(false);
    expect(prisma.state.subscriptions[0]['cancelAtPeriodEnd']).toBe(true);
  });

  it('payload mode: an event for an older billing period is skipped', async () => {
    const { prisma, send } = setup();
    await send(
      subEvent(
        'evt_1',
        'customer.subscription.created',
        baseSub({ current_period_end: nowSec() + 60 * DAY }),
      ),
    );
    const res = await send(
      subEvent(
        'evt_2',
        'customer.subscription.updated',
        baseSub({
          status: 'past_due',
          current_period_end: nowSec() + 30 * DAY,
        }),
      ),
    );
    expect(res.handled).toBe(false);
    expect(prisma.state.subscriptions[0]['status']).toBe('ACTIVE');
  });

  it('payload mode: an end-of-subscription event always applies (canceled is terminal)', async () => {
    const { prisma, send } = setup();
    const t0 = nowSec();
    await send(
      subEvent('evt_1', 'customer.subscription.created', baseSub(), t0),
    );
    const res = await send(
      subEvent(
        'evt_2',
        'customer.subscription.deleted',
        baseSub({
          status: 'canceled',
          current_period_end: t0 - DAY,
          canceled_at: t0 - DAY,
        }),
        t0 - 3600,
      ),
    );
    expect(res.handled).toBe(true);
    expect(prisma.state.subscriptions[0]['status']).toBe('CANCELED');
  });

  it('payload mode: a canceled subscription is never revived by a late event', async () => {
    const { prisma, send } = setup();
    await send(subEvent('evt_1', 'customer.subscription.created', baseSub()));
    await send(
      subEvent(
        'evt_2',
        'customer.subscription.deleted',
        baseSub({ status: 'canceled' }),
      ),
    );
    const res = await send(
      subEvent(
        'evt_3',
        'customer.subscription.updated',
        baseSub({ status: 'active' }),
      ),
    );
    expect(res.handled).toBe(false);
    expect(prisma.state.subscriptions[0]['status']).toBe('CANCELED');
  });

  it('stripe mode: applies the subscription re-read from the API, not the stale payload', async () => {
    const current: SubscriptionSnapshot = {
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY * 1000),
      cancelAtPeriodEnd: true,
      trialEnd: null,
      canceledAt: null,
      endedAt: null,
      priceIds: ['price_A'],
      metadata: { userId: 'user-1', planId: 'plan-1' },
    };
    const provider = {
      mode: 'stripe',
      constructWebhookEvent: (raw: Buffer) => JSON.parse(raw.toString()),
      retrieveSubscription: jest.fn(async () => current),
    } as unknown as BillingProvider;
    const { prisma, send } = setup(provider);
    // The event payload claims past_due + no cancel; the API says otherwise.
    await send(
      subEvent(
        'evt_1',
        'customer.subscription.updated',
        baseSub({ status: 'past_due' }),
        nowSec() - 9999,
      ),
    );
    const row = prisma.state.subscriptions[0];
    expect(provider.retrieveSubscription).toHaveBeenCalledWith('sub_1');
    expect(row['status']).toBe('ACTIVE');
    expect(row['cancelAtPeriodEnd']).toBe(true);
  });
});

describe('WebhookService — checkout (PIX / Boleto prepay)', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    id: 'cs_test_1',
    mode: 'payment',
    payment_status: 'paid',
    customer: 'cus_9',
    metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'price-annual' },
    ...over,
  });

  it('paid payment-mode session → 1-year non-renewing subscription', async () => {
    const { prisma, send } = setup();
    const created = nowSec();
    const res = await send(
      subEvent('evt_1', 'checkout.session.completed', session(), created),
    );
    expect(res.handled).toBe(true);
    const row = prisma.state.subscriptions[0];
    expect(row).toMatchObject({
      userId: 'user-1',
      planId: 'plan-1',
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: 'cs_test_1',
      stripeCustomerId: 'cus_9',
    });
    const start = new Date(created * 1000);
    const end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    expect((row['currentPeriodEnd'] as Date).getTime()).toBe(end.getTime());
  });

  it('PIX/Boleto: completed-but-unpaid waits; async_payment_succeeded grants once', async () => {
    const { prisma, send } = setup();
    const r1 = await send(
      subEvent(
        'evt_1',
        'checkout.session.completed',
        session({ payment_status: 'unpaid' }),
      ),
    );
    expect(r1.handled).toBe(false);
    expect(prisma.state.subscriptions).toHaveLength(0);

    const r2 = await send(
      subEvent(
        'evt_2',
        'checkout.session.async_payment_succeeded',
        session({ payment_status: 'paid' }),
      ),
    );
    expect(r2.handled).toBe(true);
    // A redundant later event for the same session doesn't create a second row.
    await send(subEvent('evt_3', 'checkout.session.completed', session()));
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('async_payment_failed grants nothing', async () => {
    const { prisma, send } = setup();
    const res = await send(
      subEvent(
        'evt_1',
        'checkout.session.async_payment_failed',
        session({ payment_status: 'unpaid' }),
      ),
    );
    expect(res.handled).toBe(false);
    expect(prisma.state.subscriptions).toHaveLength(0);
  });

  it('rejects forged metadata (price not on that plan / unknown user)', async () => {
    const { prisma, send } = setup();
    await send(
      subEvent(
        'evt_1',
        'checkout.session.completed',
        session({
          metadata: {
            userId: 'user-1',
            planId: 'plan-2',
            priceId: 'price-annual',
          },
        }),
      ),
    );
    await send(
      subEvent(
        'evt_2',
        'checkout.session.completed',
        session({
          metadata: {
            userId: 'ghost',
            planId: 'plan-1',
            priceId: 'price-annual',
          },
        }),
      ),
    );
    expect(prisma.state.subscriptions).toHaveLength(0);
  });
});

describe('WebhookService — raw body', () => {
  it('stripe mode without the raw body → 400 (signature needs the exact bytes)', async () => {
    const provider = {
      mode: 'stripe',
      constructWebhookEvent: jest.fn(),
    } as unknown as BillingProvider;
    const svc = new WebhookService(new FakeBillingPrisma() as never, provider);
    await expect(
      svc.handleStripe(undefined, { id: 'evt' }, 't=1,v1=x'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.constructWebhookEvent).not.toHaveBeenCalled();
  });

  it('stripe mode passes the raw Buffer and signature to the provider', async () => {
    const constructWebhookEvent = jest.fn(() => ({
      id: 'evt_x',
      type: 'ping',
      data: { object: {} },
    }));
    const provider = {
      mode: 'stripe',
      constructWebhookEvent,
      retrieveSubscription: jest.fn(),
    } as unknown as BillingProvider;
    const svc = new WebhookService(new FakeBillingPrisma() as never, provider);
    const raw = Buffer.from('{"id":"evt_x"}');
    await svc.handleStripe(raw, {}, 'sig');
    expect(constructWebhookEvent).toHaveBeenCalledWith(raw, 'sig');
  });

  it('dev mode falls back to the parsed body', async () => {
    const { prisma, svc } = setup();
    const evt = subEvent('evt_1', 'customer.subscription.created', baseSub());
    await svc.handleStripe(undefined, evt, undefined);
    expect(prisma.state.subscriptions).toHaveLength(1);
  });
});
