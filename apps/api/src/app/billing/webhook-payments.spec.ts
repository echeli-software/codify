import { Logger } from '@nestjs/common';
import {
  DevBillingProvider,
  type BillingProvider,
  type ChargeContext,
  type SubscriptionSnapshot,
} from './billing.provider.js';
import { coinKey } from '../gamification/gamification.service.js';
import type { GamificationConfigValues } from '../gamification/gamification-config.service.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';
import { makeWebhookService } from './testing/fake-billing-deps.js';
import {
  chargeContextFromPayload,
  firstPaymentBonusKey,
  isFirstPaidInvoice,
} from './webhook.service.js';

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

let seq = 0;
const evt = (
  type: string,
  object: Record<string, unknown>,
  created = nowSec(),
) => ({ id: `evt_${++seq}`, type, created, data: { object } });

function setup(
  opts: {
    provider?: BillingProvider;
    config?: Partial<GamificationConfigValues>;
    coins?: number;
  } = {},
) {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1', coins: opts.coins ?? 0 });
  prisma.state.plans.push({ id: 'plan-1', deletedAt: null });
  prisma.state.planPrices.push({
    id: 'price-annual',
    planId: 'plan-1',
    period: 'ANNUAL',
    stripePriceId: 'price_A',
  });
  const deps = makeWebhookService(
    prisma,
    opts.provider ?? new DevBillingProvider('test-secret'),
    { config: { 'billing.firstPaymentBonusCoins': 300, ...opts.config } },
  );
  const send = (e: { id: string }) =>
    deps.svc.handleStripe(Buffer.from(JSON.stringify(e)), e, undefined);
  const user = () => prisma.state.users[0] as unknown as { coins: number };
  return { prisma, ...deps, send, user };
}

/** A mirrored card subscription `sub_1` (created in the past). */
async function withSubscription(
  ctx: ReturnType<typeof setup>,
  over: Record<string, unknown> = {},
) {
  await ctx.send(
    evt(
      'customer.subscription.created',
      {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        current_period_start: nowSec() - 3600,
        current_period_end: nowSec() + 30 * DAY,
        cancel_at_period_end: false,
        metadata: { userId: 'user-1', planId: 'plan-1' },
        ...over,
      },
      nowSec() - 600,
    ),
  );
  return ctx.prisma.state.subscriptions[0];
}

const paidInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1',
  subscription: 'sub_1',
  amount_paid: 2990,
  billing_reason: 'subscription_create',
  ...over,
});

describe('invoice.paid → first-paid-invoice bonus', () => {
  it('grants billing.firstPaymentBonusCoins once, flat, as PROMO_CODE, keyed on the subscription', async () => {
    const ctx = setup();
    const row = await withSubscription(ctx);
    const res = await ctx.send(evt('invoice.paid', paidInvoice()));
    expect(res.handled).toBe(true);
    expect(ctx.user().coins).toBe(300);
    expect(ctx.gamification.grantReward.calls[0][0]).toMatchObject({
      userId: 'user-1',
      baseXp: 0,
      baseCoins: 300,
      coinSource: 'PROMO_CODE',
      idempotencyKey: `billing_bonus:${row.id}`,
      flat: true,
    });
    // Passed the webhook transaction (same tx as the claim).
    expect(ctx.gamification.grantReward.calls[0][1]).toBe(ctx.prisma);

    // A second delivery of the "first" invoice under a new event id and a
    // later renewal invoice never pay again.
    await ctx.send(evt('invoice.paid', paidInvoice(), nowSec() + 5));
    await ctx.send(
      evt(
        'invoice.paid',
        paidInvoice({ id: 'in_2', billing_reason: 'subscription_cycle' }),
        nowSec() + 10,
      ),
    );
    expect(ctx.user().coins).toBe(300);
    expect(ctx.gamification.grantReward.calls).toHaveLength(1);
  });

  it('is off at the default 0 and skips $0 (trial) invoices', async () => {
    const off = setup({ config: { 'billing.firstPaymentBonusCoins': 0 } });
    await withSubscription(off);
    await off.send(evt('invoice.paid', paidInvoice()));
    expect(off.gamification.grantReward.calls).toHaveLength(0);

    const trial = setup();
    await withSubscription(trial);
    await trial.send(evt('invoice.paid', paidInvoice({ amount_paid: 0 })));
    expect(trial.gamification.grantReward.calls).toHaveLength(0);
  });

  it('after a free trial, the first cycle invoice (period starting at trial end) is the first paid one', () => {
    const trialEndsAt = new Date('2026-10-14T12:00:00Z');
    const cycle = (start: string) => ({
      amount_paid: 2990,
      billing_reason: 'subscription_cycle',
      lines: {
        data: [{ period: { start: Date.parse(start) / 1000 } }],
      },
    });
    expect(
      isFirstPaidInvoice(cycle('2026-10-14T12:00:05Z'), { trialEndsAt }),
    ).toBe(true);
    expect(
      isFirstPaidInvoice(cycle('2026-11-14T12:00:00Z'), { trialEndsAt }),
    ).toBe(false);
    expect(
      isFirstPaidInvoice(cycle('2026-10-14T12:00:05Z'), { trialEndsAt: null }),
    ).toBe(false);
  });

  it('a rolled-back delivery does not leave a bonus behind (retry grants it once)', async () => {
    const ctx = setup();
    await withSubscription(ctx);
    ctx.prisma.failNext = {
      op: 'subscription.update',
      error: new Error('db hiccup'),
    };
    const e = evt('invoice.paid', paidInvoice(), nowSec() + 5);
    await expect(ctx.send(e)).rejects.toThrow('db hiccup');
    expect(ctx.prisma.state.coinTransactions).toHaveLength(0);
    await ctx.send(e);
    expect(
      ctx.prisma.state.coinTransactions.filter((c) =>
        String(c['idempotencyKey']).startsWith('billing_bonus:'),
      ),
    ).toHaveLength(1);
  });

  it('a PIX/Boleto prepay is the first payment too (bonus once per session)', async () => {
    const ctx = setup();
    const session = {
      id: 'cs_live_1',
      mode: 'payment',
      payment_status: 'paid',
      metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'price-annual' },
    };
    await ctx.send(evt('checkout.session.completed', session));
    await ctx.send(evt('checkout.session.async_payment_succeeded', session));
    expect(ctx.user().coins).toBe(300);
    expect(ctx.gamification.grantReward.calls).toHaveLength(1);
  });
});

describe('invoice.payment_failed → recovery push', () => {
  it('pushes once, on the transition into PAST_DUE, after commit, in the user locale', async () => {
    const ctx = setup();
    const row = await withSubscription(ctx);
    await ctx.send(
      evt('invoice.payment_failed', { subscription: 'sub_1' }, nowSec() + 5),
    );
    expect(ctx.push.sendToUser.calls).toHaveLength(1);
    const [userId, content, opts] = ctx.push.sendToUser.calls[0] as [
      string,
      (u: { locale: string }) => {
        title: string;
        body: string;
        data: Record<string, string>;
      },
      unknown,
    ];
    expect(userId).toBe('user-1');
    expect(opts).toEqual({ kind: 'BILLING' });
    expect(content({ locale: 'pt-BR' }).title).toBe('Pagamento não aprovado');
    expect(content({ locale: 'en-US' })).toMatchObject({
      title: 'Payment failed',
      data: { type: 'billing_payment_failed', subscriptionId: row.id },
    });

    // Stripe's smart retries fail again → still PAST_DUE → no second push.
    await ctx.send(
      evt('invoice.payment_failed', { subscription: 'sub_1' }, nowSec() + 60),
    );
    expect(ctx.push.sendToUser.calls).toHaveLength(1);
  });

  it('a push failure never fails the (already committed) event', async () => {
    const ctx = setup();
    await withSubscription(ctx);
    const err = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    ctx.push.result = null as never;
    const original = ctx.push.sendToUser;
    (ctx.push as { sendToUser: unknown }).sendToUser = async () => {
      throw new Error('fcm down');
    };
    await expect(
      ctx.send(
        evt('invoice.payment_failed', { subscription: 'sub_1' }, nowSec() + 5),
      ),
    ).resolves.toMatchObject({ handled: true });
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('PAST_DUE');
    (ctx.push as { sendToUser: unknown }).sendToUser = original;
    err.mockRestore();
  });
});

describe('charge.refunded', () => {
  const charge = (over: Record<string, unknown> = {}) => ({
    id: 'ch_1',
    amount: 2990,
    amount_refunded: 2990,
    refunded: true,
    currency: 'brl',
    invoice: { id: 'in_1', subscription: 'sub_1' },
    ...over,
  });

  it('full refund of the latest invoice ends access now, audits, and claws the bonus back', async () => {
    const ctx = setup({ coins: 50 });
    await withSubscription(ctx);
    await ctx.send(evt('invoice.paid', paidInvoice()));
    expect(ctx.user().coins).toBe(350);

    const before = Date.now();
    const res = await ctx.send(evt('charge.refunded', charge()));
    expect(res.handled).toBe(true);
    const row = ctx.prisma.state.subscriptions[0];
    expect(row['status']).toBe('CANCELED');
    expect((row['currentPeriodEnd'] as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect((row['currentPeriodEnd'] as Date).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(row['canceledAt']).toEqual(row['currentPeriodEnd']);
    expect(ctx.user().coins).toBe(50);
    expect(ctx.gamification.spendCoins.calls[0][0]).toMatchObject({
      amount: 300,
      source: 'PURCHASE_REFUND',
      capAtBalance: true,
    });

    expect(ctx.prisma.state.auditLogs).toHaveLength(1);
    expect(ctx.prisma.state.auditLogs[0]).toMatchObject({
      action: 'billing.refund',
      entity: 'Subscription',
      entityId: row.id,
      diff: expect.objectContaining({
        amount: 2990,
        currency: 'BRL',
        chargeId: 'ch_1',
        invoiceId: 'in_1',
        stripeSubscriptionId: 'sub_1',
        full: true,
        accessEnded: true,
        clawedBack: 300,
      }),
    });
  });

  it('the clawback is capped at the balance (never negative)', async () => {
    const ctx = setup();
    await withSubscription(ctx);
    await ctx.send(evt('invoice.paid', paidInvoice()));
    ctx.user().coins = 120; // spent most of the bonus already
    await ctx.send(evt('charge.refunded', charge()));
    expect(ctx.user().coins).toBe(0);
    expect(ctx.prisma.state.auditLogs[0]['diff']).toMatchObject({
      clawedBack: 120,
    });
  });

  it('no clawback outside billing.refundWindowDays', async () => {
    const ctx = setup({ config: { 'billing.refundWindowDays': 7 } });
    await withSubscription(ctx);
    ctx.prisma.clock = new Date(Date.now() - 8 * DAY * 1000);
    await ctx.send(evt('invoice.paid', paidInvoice()));
    ctx.prisma.clock = null;
    await ctx.send(evt('charge.refunded', charge()));
    expect(ctx.user().coins).toBe(300);
    expect(ctx.gamification.spendCoins.calls).toHaveLength(0);
    // Access still ends — the refund itself is in scope.
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('CANCELED');
  });

  it('a partial refund is recorded only (access and bonus untouched)', async () => {
    const ctx = setup();
    await withSubscription(ctx);
    await ctx.send(evt('invoice.paid', paidInvoice()));
    await ctx.send(
      evt(
        'charge.refunded',
        charge({ amount_refunded: 1000, refunded: false }),
      ),
    );
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('ACTIVE');
    expect(ctx.user().coins).toBe(300);
    expect(ctx.prisma.state.auditLogs[0]['diff']).toMatchObject({
      amount: 1000,
      full: false,
      accessEnded: false,
      clawedBack: 0,
    });
  });

  it('stripe mode: only the latest invoice ends access; a full refund cancels the Stripe subscription after commit', async () => {
    const snapshot: SubscriptionSnapshot = {
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 3600_000),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY * 1000),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      canceledAt: null,
      endedAt: null,
      priceIds: ['price_A'],
      metadata: { userId: 'user-1', planId: 'plan-1' },
      latestInvoiceId: 'in_2',
    };
    const resolved: ChargeContext = {
      invoiceId: 'in_1',
      subscriptionId: 'sub_1',
      checkoutSessionId: null,
    };
    const provider = {
      mode: 'stripe',
      constructWebhookEvent: (raw: Buffer) => JSON.parse(raw.toString()),
      retrieveSubscription: jest.fn(async () => snapshot),
      resolveChargeContext: jest.fn(async () => resolved),
      cancelSubscriptionNow: jest.fn(async () => null),
    } as unknown as BillingProvider;
    const ctx = setup({ provider });
    await withSubscription(ctx);

    // Refund of an older invoice (in_1 ≠ latest in_2): recorded, access kept.
    await ctx.send(evt('charge.refunded', charge({ invoice: undefined })));
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('ACTIVE');
    expect(provider.cancelSubscriptionNow).not.toHaveBeenCalled();

    resolved.invoiceId = 'in_2';
    await ctx.send(
      evt('charge.refunded', charge({ id: 'ch_2', invoice: undefined })),
    );
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('CANCELED');
    expect(provider.cancelSubscriptionNow).toHaveBeenCalledWith('sub_1');
    expect(provider.resolveChargeContext).toHaveBeenCalledTimes(2);
  });

  it('a PIX/Boleto prepay refund ends access (by session id, or by PaymentIntent metadata)', async () => {
    for (const refund of [
      { metadata: { checkoutSessionId: 'cs_live_9' } },
      { metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'x' } },
    ]) {
      const ctx = setup();
      await ctx.send(
        evt('checkout.session.completed', {
          id: 'cs_live_9',
          mode: 'payment',
          payment_status: 'paid',
          metadata: {
            userId: 'user-1',
            planId: 'plan-1',
            priceId: 'price-annual',
          },
        }),
      );
      const res = await ctx.send(
        evt('charge.refunded', charge({ invoice: null, ...refund })),
      );
      expect(res.handled).toBe(true);
      expect(ctx.prisma.state.subscriptions[0]['status']).toBe('CANCELED');
      expect(ctx.user().coins).toBe(0); // prepay bonus clawed back
    }
  });

  it('without a resolvable subscription: handled:false, logged and recorded', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const ctx = setup();
    const res = await ctx.send(
      evt('charge.refunded', charge({ invoice: 'in_unknown' })),
    );
    expect(res).toEqual({ received: true, duplicate: false, handled: false });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no subscription resolvable'),
    );
    expect(ctx.prisma.state.auditLogs[0]).toMatchObject({
      action: 'billing.refund',
      entity: 'Charge',
      entityId: 'ch_1',
      diff: expect.objectContaining({ resolved: false }),
    });
    warn.mockRestore();
  });

  it('payload context: string / expanded invoice (both subscription shapes) and session metadata', () => {
    expect(chargeContextFromPayload({ invoice: 'in_1' })).toEqual({
      invoiceId: 'in_1',
      subscriptionId: null,
      checkoutSessionId: null,
    });
    expect(
      chargeContextFromPayload({
        invoice: {
          id: 'in_2',
          parent: { subscription_details: { subscription: 'sub_9' } },
        },
      }),
    ).toMatchObject({ invoiceId: 'in_2', subscriptionId: 'sub_9' });
    expect(
      chargeContextFromPayload({ metadata: { checkoutSessionId: 'cs_1' } }),
    ).toMatchObject({ checkoutSessionId: 'cs_1' });
  });

  it('bonus keys line up with the coin journal the clawback reads', () => {
    expect(coinKey(firstPaymentBonusKey('row-1'))).toBe(
      'billing_bonus:row-1:coin',
    );
  });
});
