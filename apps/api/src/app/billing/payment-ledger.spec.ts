import { DevBillingProvider } from './billing.provider.js';
import { refundStatus, stripeMethodOf } from './payments.js';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';
import { DevRevenueCatProvider } from './revenuecat.provider.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';
import { makeWebhookService } from './testing/fake-billing-deps.js';

/**
 * Payment ledger + ordering guard, driven by fixture webhook events
 * (docs/09 §6: "log payment", "record refund"; Subscription.lastStripeEventAt).
 */

const DAY = 86_400;
const T0 = 1_790_000_000; // fixed unix seconds for deterministic ordering
let seq = 0;
const evt = (
  type: string,
  object: Record<string, unknown>,
  created: number,
) => ({
  id: `evt_l${++seq}`,
  type,
  created,
  data: { object },
});

function setup() {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1', coins: 0 });
  prisma.state.plans.push({ id: 'plan-1', deletedAt: null, name: 'Pro' });
  prisma.state.planPrices.push({
    id: 'price-annual',
    planId: 'plan-1',
    period: 'ANNUAL',
    stripePriceId: 'price_A',
  });
  const deps = makeWebhookService(prisma, new DevBillingProvider('s'), {
    config: { 'billing.firstPaymentBonusCoins': 0 },
  });
  const send = (e: { id: string }) =>
    deps.svc.handleStripe(Buffer.from(JSON.stringify(e)), e, undefined);
  return { prisma, send, ...deps };
}

const subObject = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  current_period_start: T0,
  current_period_end: T0 + 30 * DAY,
  cancel_at_period_end: false,
  metadata: { userId: 'user-1', planId: 'plan-1' },
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1',
  customer: 'cus_1',
  subscription: 'sub_1',
  currency: 'brl',
  amount_paid: 2990,
  amount_due: 2990,
  billing_reason: 'subscription_create',
  hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
  status_transitions: { paid_at: T0 + 60 },
  payment_intent: {
    id: 'pi_1',
    latest_charge: { id: 'ch_1', payment_method_details: { type: 'card' } },
  },
  ...over,
});

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'ch_1',
  amount: 2990,
  amount_refunded: 1000,
  refunded: false,
  currency: 'brl',
  created: T0 + 60,
  invoice: { id: 'in_1', subscription: 'sub_1', created: T0 },
  payment_method_details: { type: 'card' },
  receipt_url: 'https://pay.stripe.com/receipts/ch_1',
  ...over,
});

async function mirrored(ctx: ReturnType<typeof setup>) {
  await ctx.send(evt('customer.subscription.created', subObject(), T0));
  return ctx.prisma.state.subscriptions[0];
}

describe('Stripe → Payment', () => {
  it('invoice.paid upserts a PAID payment (amount, currency, method, receipt, paidAt)', async () => {
    const ctx = setup();
    const sub = await mirrored(ctx);
    await ctx.send(evt('invoice.paid', invoice(), T0 + 60));
    expect(ctx.prisma.state.payments).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        subscriptionId: sub.id,
        provider: 'STRIPE',
        externalId: 'in_1',
        amountCents: 2990,
        currency: 'BRL',
        status: 'PAID',
        method: 'card',
        receiptUrl: 'https://invoice.stripe.com/i/in_1',
        paidAt: new Date((T0 + 60) * 1000),
        refundedCents: 0,
      }),
    ]);
    // Same invoice under another event id: still one row.
    await ctx.send(evt('invoice.paid', invoice(), T0 + 61));
    expect(ctx.prisma.state.payments).toHaveLength(1);
  });

  it('a late invoice.payment_failed (earlier attempt) never downgrades a paid invoice', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(evt('invoice.paid', invoice(), T0 + 120));
    await ctx.send(
      evt('invoice.payment_failed', invoice({ amount_paid: 0 }), T0 + 60),
    );
    expect(ctx.prisma.state.payments[0]).toMatchObject({ status: 'PAID' });
  });

  it('failed then paid: FAILED row becomes PAID', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(
      evt(
        'invoice.payment_failed',
        invoice({ amount_paid: 0, payment_intent: 'pi_1' }),
        T0 + 60,
      ),
    );
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'FAILED',
      amountCents: 2990,
      method: null,
      paidAt: null,
    });
    await ctx.send(evt('invoice.paid', invoice(), T0 + 120));
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'PAID',
      method: 'card',
    });
  });

  it('$0 invoices are not payments; unknown owners are skipped', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(
      evt('invoice.paid', invoice({ id: 'in_0', amount_paid: 0 }), T0 + 5),
    );
    await ctx.send(
      evt(
        'invoice.paid',
        invoice({ id: 'in_x', subscription: 'sub_unknown', customer: 'cus_x' }),
        T0 + 5,
      ),
    );
    expect(ctx.prisma.state.payments).toHaveLength(0);
  });

  it('owner falls back to the customer when the subscription is not mirrored', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(
      evt(
        'invoice.paid',
        invoice({ id: 'in_9', subscription: 'sub_other' }),
        T0 + 5,
      ),
    );
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      externalId: 'in_9',
      userId: 'user-1',
      subscriptionId: null,
    });
  });

  it('charge.refunded: partial then full; refundedCents only grows', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(evt('invoice.paid', invoice(), T0 + 60));
    await ctx.send(evt('charge.refunded', charge(), T0 + 200));
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedCents: 1000,
    });
    await ctx.send(
      evt(
        'charge.refunded',
        charge({ amount_refunded: 2990, refunded: true }),
        T0 + 300,
      ),
    );
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 2990,
    });
    // An older partial-refund event delivered late does not shrink it.
    await ctx.send(evt('charge.refunded', charge(), T0 + 250));
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 2990,
    });
    // A late invoice.paid keeps the refund.
    await ctx.send(evt('invoice.paid', invoice(), T0 + 61));
    expect(ctx.prisma.state.payments[0]).toMatchObject({ status: 'REFUNDED' });
  });

  it('a refund delivered before the payment creates the row from the charge', async () => {
    const ctx = setup();
    await mirrored(ctx);
    await ctx.send(evt('charge.refunded', charge(), T0 + 200));
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      externalId: 'in_1',
      amountCents: 2990,
      refundedCents: 1000,
      status: 'PARTIALLY_REFUNDED',
      method: 'card',
      receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
    });
    await ctx.send(evt('invoice.paid', invoice(), T0 + 60));
    expect(ctx.prisma.state.payments).toHaveLength(1);
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      receiptUrl: 'https://invoice.stripe.com/i/in_1',
    });
  });

  it('PIX prepay checkout logs a payment keyed on the session; its refund marks it', async () => {
    const ctx = setup();
    const session = {
      id: 'cs_live_7',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 29900,
      currency: 'brl',
      payment_method_types: ['pix'],
      metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'price-annual' },
    };
    await ctx.send(evt('checkout.session.completed', session, T0));
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      externalId: 'cs_live_7',
      amountCents: 29900,
      method: 'pix',
      status: 'PAID',
    });
    await ctx.send(
      evt(
        'charge.refunded',
        charge({
          id: 'ch_p',
          invoice: null,
          amount: 29900,
          amount_refunded: 29900,
          refunded: true,
          payment_method_details: { type: 'pix' },
          metadata: { checkoutSessionId: 'cs_live_7', userId: 'user-1' },
        }),
        T0 + 100,
      ),
    );
    expect(ctx.prisma.state.payments).toHaveLength(1);
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 29900,
    });
  });
});

describe('Stripe ordering guard (Subscription.lastStripeEventAt)', () => {
  it('records the newest applied event time and ignores older updates', async () => {
    const ctx = setup();
    const row = await mirrored(ctx);
    expect(row['lastStripeEventAt']).toEqual(new Date(T0 * 1000));

    await ctx.send(
      evt(
        'customer.subscription.updated',
        subObject({ cancel_at_period_end: true }),
        T0 + 100,
      ),
    );
    expect(row).toMatchObject({
      cancelAtPeriodEnd: true,
      lastStripeEventAt: new Date((T0 + 100) * 1000),
    });

    // An older update (created before the one applied) is ignored.
    const res = await ctx.send(
      evt(
        'customer.subscription.updated',
        subObject({ cancel_at_period_end: false }),
        T0 + 50,
      ),
    );
    expect(res.handled).toBe(false);
    expect(row['cancelAtPeriodEnd']).toBe(true);
    expect(row['lastStripeEventAt']).toEqual(new Date((T0 + 100) * 1000));
  });

  it('older invoice events do not flip status, but the payment is still logged', async () => {
    const ctx = setup();
    const row = await mirrored(ctx);
    await ctx.send(
      evt(
        'customer.subscription.updated',
        subObject({ status: 'active' }),
        T0 + 100,
      ),
    );
    await ctx.send(
      evt('invoice.payment_failed', invoice({ id: 'in_old' }), T0 + 50),
    );
    expect(row['status']).toBe('ACTIVE');
    expect(ctx.prisma.state.payments[0]).toMatchObject({
      externalId: 'in_old',
      status: 'FAILED',
    });
  });

  it('cancellation is terminal: applies even when older than the high-water mark', async () => {
    const ctx = setup();
    const row = await mirrored(ctx);
    await ctx.send(evt('invoice.paid', invoice(), T0 + 200));
    await ctx.send(
      evt(
        'customer.subscription.deleted',
        subObject({ status: 'canceled', ended_at: T0 + 150 }),
        T0 + 150,
      ),
    );
    expect(row['status']).toBe('CANCELED');
    expect(row['lastStripeEventAt']).toEqual(new Date((T0 + 200) * 1000));
  });
});

describe('RevenueCat → Payment', () => {
  function rc() {
    const prisma = new FakeBillingPrisma();
    prisma.state.users.push({ id: 'user-1' });
    prisma.state.plans.push({
      id: 'plan-ent',
      deletedAt: null,
      revenueCatEntitlementId: 'all_access',
    });
    const svc = new RevenueCatWebhookService(
      prisma as never,
      new DevRevenueCatProvider(),
    );
    const send = (event: Record<string, unknown>) =>
      svc.handle(JSON.stringify({ event }), undefined);
    return { prisma, send };
  }
  const base = {
    app_user_id: 'user-1',
    product_id: 'codify_monthly',
    entitlement_ids: ['all_access'],
    period_type: 'NORMAL',
    purchased_at_ms: T0 * 1000,
    expiration_at_ms: (T0 + 30 * DAY) * 1000,
    store: 'APP_STORE',
    original_transaction_id: 'otx_1',
    currency: 'BRL',
  };

  it('purchase + renewal are PAID store payments; a support refund marks REFUNDED', async () => {
    const { prisma, send } = rc();
    await send({
      ...base,
      id: 'rc_1',
      type: 'INITIAL_PURCHASE',
      transaction_id: 'otx_1',
      price_in_purchased_currency: 29.9,
      price: 5.99,
    });
    await send({
      ...base,
      id: 'rc_2',
      type: 'RENEWAL',
      transaction_id: 'tx_2',
      purchased_at_ms: (T0 + 30 * DAY) * 1000,
      expiration_at_ms: (T0 + 60 * DAY) * 1000,
      price_in_purchased_currency: 29.9,
    });
    const sub = prisma.state.subscriptions[0];
    expect(prisma.state.payments).toEqual([
      expect.objectContaining({
        provider: 'APPLE',
        externalId: 'otx_1',
        amountCents: 2990,
        currency: 'BRL',
        method: 'store',
        status: 'PAID',
        subscriptionId: sub.id,
      }),
      expect.objectContaining({ externalId: 'tx_2', status: 'PAID' }),
    ]);

    await send({
      ...base,
      id: 'rc_3',
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      transaction_id: 'tx_2',
      price_in_purchased_currency: -29.9,
    });
    expect(prisma.state.payments[1]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 2990,
    });
    // Replay of the same event id: no change, no duplicate.
    await send({
      ...base,
      id: 'rc_2',
      type: 'RENEWAL',
      transaction_id: 'tx_2',
      price_in_purchased_currency: 29.9,
    });
    expect(prisma.state.payments).toHaveLength(2);
    expect(prisma.state.payments[1]['status']).toBe('REFUNDED');
  });

  it('skips trials, plain cancellations and Stripe purchases relayed by RevenueCat', async () => {
    const { prisma, send } = rc();
    await send({
      ...base,
      id: 'rc_t',
      type: 'INITIAL_PURCHASE',
      period_type: 'TRIAL',
      transaction_id: 'otx_1',
      price_in_purchased_currency: 0,
    });
    await send({
      ...base,
      id: 'rc_c',
      type: 'CANCELLATION',
      cancel_reason: 'UNSUBSCRIBE',
      transaction_id: 'otx_1',
      price_in_purchased_currency: 29.9,
    });
    await send({
      ...base,
      id: 'rc_s',
      type: 'RENEWAL',
      store: 'STRIPE',
      transaction_id: 'in_77',
      price_in_purchased_currency: 29.9,
    });
    expect(prisma.state.payments).toHaveLength(0);
  });

  it('Google Play maps to GOOGLE; missing purchased-currency price falls back to USD price', async () => {
    const { prisma, send } = rc();
    await send({
      ...base,
      id: 'rc_g',
      type: 'INITIAL_PURCHASE',
      store: 'PLAY_STORE',
      transaction_id: 'GPA.1',
      original_transaction_id: 'GPA.1',
      price: 5.99,
      currency: null,
    });
    expect(prisma.state.payments[0]).toMatchObject({
      provider: 'GOOGLE',
      amountCents: 599,
      currency: 'USD',
    });
  });
});

describe('payments helpers', () => {
  it('stripeMethodOf reads charges, expanded intents and checkout sessions', () => {
    expect(stripeMethodOf({ payment_method_details: { type: 'boleto' } })).toBe(
      'boleto',
    );
    expect(
      stripeMethodOf({ payment_intent: { payment_method_types: ['pix'] } }),
    ).toBe('pix');
    expect(
      stripeMethodOf({
        payments: {
          data: [
            {
              payment: {
                payment_intent: {
                  latest_charge: { payment_method_details: { type: 'card' } },
                },
              },
            },
          ],
        },
      }),
    ).toBe('card');
    expect(
      stripeMethodOf({ payment_method_types: ['card', 'pix'] }),
    ).toBeNull();
    expect(
      stripeMethodOf({ payment_method_details: { type: 'link' } }),
    ).toBeNull();
    expect(stripeMethodOf({ payment_intent: 'pi_1' })).toBeNull();
  });

  it('refundStatus', () => {
    expect(refundStatus(1000, 0, 'PAID')).toBe('PAID');
    expect(refundStatus(1000, 0, 'FAILED')).toBe('FAILED');
    expect(refundStatus(1000, 1, 'PAID')).toBe('PARTIALLY_REFUNDED');
    expect(refundStatus(1000, 1000, 'PAID')).toBe('REFUNDED');
  });
});
