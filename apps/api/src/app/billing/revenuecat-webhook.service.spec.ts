import { BadRequestException } from '@nestjs/common';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';
import {
  DevRevenueCatProvider,
  RevenueCatHttpProvider,
  constantTimeEquals,
} from './revenuecat.provider.js';
import { createRevenueCatProvider } from './billing-provider.factory.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';

const DAY_MS = 86_400_000;

function setup() {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1' });
  prisma.state.plans.push(
    {
      id: 'plan-ent',
      deletedAt: null,
      isActive: true,
      revenueCatEntitlementId: 'all_access',
    },
    {
      id: 'plan-sku',
      deletedAt: null,
      isActive: false,
      revenueCatEntitlementId: 'other',
    },
  );
  prisma.state.planPrices.push({
    id: 'pp-1',
    planId: 'plan-sku',
    storeProductId: 'codify_annual',
    stripePriceId: null,
  });
  const svc = new RevenueCatWebhookService(
    prisma as never,
    new DevRevenueCatProvider(),
  );
  const send = (event: Record<string, unknown>) =>
    svc.handle(JSON.stringify({ event }), undefined);
  return { prisma, svc, send };
}

const purchase = (over: Record<string, unknown> = {}) => ({
  id: 'rc_1',
  type: 'INITIAL_PURCHASE',
  app_user_id: 'user-1',
  product_id: 'codify_monthly',
  entitlement_ids: ['all_access'],
  period_type: 'NORMAL',
  purchased_at_ms: Date.now(),
  expiration_at_ms: Date.now() + 30 * DAY_MS,
  store: 'APP_STORE',
  original_transaction_id: 'otx_1',
  ...over,
});

describe('RevenueCatWebhookService', () => {
  it('a failed delivery leaves no idempotency record, so the retry is processed', async () => {
    const { prisma, send } = setup();
    prisma.failNext = {
      op: 'subscription.create',
      error: new Error('db down'),
    };
    await expect(send(purchase())).rejects.toThrow('db down');
    expect(prisma.state.idempotency.size).toBe(0);

    await expect(send(purchase())).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: true,
    });
    await expect(send(purchase())).resolves.toEqual({
      received: true,
      duplicate: true,
      handled: false,
    });
    expect(prisma.state.subscriptions).toHaveLength(1);
  });

  it('resolves the plan by PlanPrice.storeProductId before the entitlement (inactive plan ok)', async () => {
    const { prisma, send } = setup();
    await send(purchase({ product_id: 'codify_annual' }));
    expect(prisma.state.subscriptions[0]).toMatchObject({
      planId: 'plan-sku',
      source: 'APPLE_IAP',
      storeProductId: 'codify_annual',
    });
  });

  it('falls back to the entitlement mapping', async () => {
    const { prisma, send } = setup();
    await send(purchase({ product_id: 'unknown_sku' }));
    expect(prisma.state.subscriptions[0]['planId']).toBe('plan-ent');
  });

  it('acks an unknown app_user_id with handled:false instead of failing on the FK', async () => {
    const { prisma, send } = setup();
    const res = await send(purchase({ app_user_id: '$RCAnonymousID:abc' }));
    expect(res).toEqual({ received: true, duplicate: false, handled: false });
    expect(prisma.state.subscriptions).toHaveLength(0);
    expect(prisma.state.idempotency.has('revenuecat:rc_1')).toBe(true); // not retried forever
  });

  it('BILLING_ISSUE sets pastDueSince; RENEWAL clears it', async () => {
    const { prisma, send } = setup();
    const exp = Date.now() + 30 * DAY_MS;
    await send(purchase({ expiration_at_ms: exp }));
    const ts = Date.now() + 1000;
    await send({
      ...purchase(),
      id: 'rc_2',
      type: 'BILLING_ISSUE',
      expiration_at_ms: exp,
      event_timestamp_ms: ts,
    });
    const row = prisma.state.subscriptions[0];
    expect(row['status']).toBe('PAST_DUE');
    expect((row['pastDueSince'] as Date).getTime()).toBe(ts);

    await send({
      ...purchase(),
      id: 'rc_3',
      type: 'RENEWAL',
      expiration_at_ms: exp + 30 * DAY_MS,
    });
    expect(row['status']).toBe('ACTIVE');
    expect(row['pastDueSince']).toBeNull();
  });

  it('ordering: a late EXPIRATION / CANCELLATION for an older period cannot undo a renewal', async () => {
    const { prisma, send } = setup();
    const firstEnd = Date.now() + 1000;
    await send(purchase({ expiration_at_ms: firstEnd }));
    await send({
      ...purchase(),
      id: 'rc_renew',
      type: 'RENEWAL',
      expiration_at_ms: firstEnd + 30 * DAY_MS,
    });

    const lateExp = await send({
      ...purchase(),
      id: 'rc_exp',
      type: 'EXPIRATION',
      expiration_at_ms: firstEnd,
    });
    const lateCancel = await send({
      ...purchase(),
      id: 'rc_can',
      type: 'CANCELLATION',
      expiration_at_ms: firstEnd,
    });
    expect(lateExp.handled).toBe(false);
    expect(lateCancel.handled).toBe(false);
    const row = prisma.state.subscriptions[0];
    expect(row['status']).toBe('ACTIVE');
    expect(row['cancelAtPeriodEnd']).toBe(false);

    // ...and a late INITIAL_PURCHASE replay can't move the period back.
    const lateBuy = await send({
      ...purchase(),
      id: 'rc_old_buy',
      expiration_at_ms: firstEnd,
    });
    expect(lateBuy.handled).toBe(false);
    expect((row['currentPeriodEnd'] as Date).getTime()).toBe(
      firstEnd + 30 * DAY_MS,
    );
  });

  it('CANCELLATION → cancelAtPeriodEnd; EXPIRATION → CANCELED with the period closed', async () => {
    const { prisma, send } = setup();
    const exp = Date.now() + 5 * DAY_MS;
    await send(purchase({ expiration_at_ms: exp }));
    await send({
      ...purchase(),
      id: 'rc_c',
      type: 'CANCELLATION',
      expiration_at_ms: exp,
    });
    const row = prisma.state.subscriptions[0];
    expect(row['cancelAtPeriodEnd']).toBe(true);
    await send({
      ...purchase(),
      id: 'rc_e',
      type: 'EXPIRATION',
      expiration_at_ms: exp,
    });
    expect(row['status']).toBe('CANCELED');
    expect(row['cancelAtPeriodEnd']).toBe(false);
  });

  it('rejects an unauthenticated payload with 400', async () => {
    const prisma = new FakeBillingPrisma();
    const svc = new RevenueCatWebhookService(
      prisma as never,
      new RevenueCatHttpProvider('s3cret'),
    );
    await expect(
      svc.handle(JSON.stringify({ event: purchase() }), 'wrong'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RevenueCat providers', () => {
  it('constantTimeEquals compares exactly, independent of length', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });

  it('RevenueCatHttpProvider checks the Authorization secret', () => {
    const p = new RevenueCatHttpProvider('s3cret');
    const body = JSON.stringify({ event: purchase() });
    expect(p.constructEvent(body, 's3cret')?.id).toBe('rc_1');
    expect(p.constructEvent(body, 's3cre')).toBeNull();
    expect(p.constructEvent(body, undefined)).toBeNull();
  });

  it('factory: secret → http provider; none → dev; production without secret → throws', () => {
    expect(
      createRevenueCatProvider({ REVENUECAT_WEBHOOK_AUTH: 'x' }).mode,
    ).toBe('revenuecat');
    expect(createRevenueCatProvider({}).mode).toBe('dev');
    expect(() => createRevenueCatProvider({ NODE_ENV: 'production' })).toThrow(
      /REVENUECAT_WEBHOOK_AUTH/,
    );
  });
});
