import {
  DevBillingProvider,
  decodeDevSession,
  encodeDevSession,
  isRecurringStripeSubscriptionId,
  snapshotFromStripeSubscription,
  type DevCheckoutPayload,
} from './billing.provider.js';

const payload: DevCheckoutPayload = {
  userId: 'user-1',
  planId: 'plan-basic',
  priceId: 'price-monthly',
  paymentMethod: 'card',
  trialDays: 7,
  period: 'MONTHLY',
};

describe('dev checkout session signing', () => {
  it('round-trips a signed session', () => {
    const id = encodeDevSession(payload, 'secret-a');
    expect(id.startsWith('cs_dev_')).toBe(true);
    expect(decodeDevSession(id, 'secret-a')).toEqual(payload);
  });

  it('rejects a session signed with another secret', () => {
    expect(
      decodeDevSession(encodeDevSession(payload, 'secret-a'), 'secret-b'),
    ).toBeNull();
  });

  it('rejects a forged payload (plan / period swapped, old signature kept)', () => {
    const id = encodeDevSession(payload, 'secret-a');
    const sig = id.slice(id.lastIndexOf('.') + 1);
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...payload,
        planId: 'plan-all-access',
        period: 'ANNUAL',
      }),
    ).toString('base64url');
    expect(
      decodeDevSession(`cs_dev_${forgedBody}.${sig}`, 'secret-a'),
    ).toBeNull();
  });

  it('rejects the old unsigned format and malformed ids', () => {
    const unsigned =
      'cs_dev_' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(decodeDevSession(unsigned, 'secret-a')).toBeNull();
    expect(decodeDevSession('cs_dev_.', 'secret-a')).toBeNull();
    expect(decodeDevSession('cs_live_123', 'secret-a')).toBeNull();
    expect(decodeDevSession('cs_dev_abc.', 'secret-a')).toBeNull();
  });

  it('DevBillingProvider verifies only its own sessions (random secret per instance)', async () => {
    const a = new DevBillingProvider();
    const b = new DevBillingProvider();
    const { sessionId, url } = await a.createCheckoutSession({
      user: { id: 'user-1', email: 'a@x' },
      customerId: null,
      plan: {
        id: 'plan-basic',
        name: 'Basic',
        trialDays: 7,
        stripeProductId: null,
      },
      price: {
        id: 'price-monthly',
        stripePriceId: null,
        currency: 'BRL',
        amountCents: 3990,
        period: 'MONTHLY',
        maxInstallments: null,
      },
      paymentMethod: 'card',
      successUrl: 'http://localhost:4202/billing/success',
      cancelUrl: 'http://localhost:4202/subscription',
    });
    expect(url).toContain(encodeURIComponent(sessionId));
    expect(a.verifySession(sessionId)).toEqual(payload);
    expect(b.verifySession(sessionId)).toBeNull();
    expect(new DevBillingProvider('fixed').verifySession(sessionId)).toBeNull();
  });
});

describe('snapshotFromStripeSubscription', () => {
  it('reads legacy top-level periods and expanded customer / prices', () => {
    const snap = snapshotFromStripeSubscription({
      id: 'sub_1',
      customer: { id: 'cus_1' },
      status: 'past_due',
      current_period_start: 1_000,
      current_period_end: 2_000,
      cancel_at_period_end: false,
      items: { data: [{ price: 'price_1' }] },
      metadata: { userId: 'u', junk: 5 },
    });
    expect(snap).toMatchObject({
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'past_due',
      cancelAtPeriodEnd: false,
      priceIds: ['price_1'],
      metadata: { userId: 'u' },
    });
    expect(snap?.currentPeriodEnd?.getTime()).toBe(2_000_000);
  });

  it('returns null for non-objects / missing id', () => {
    expect(snapshotFromStripeSubscription(null)).toBeNull();
    expect(snapshotFromStripeSubscription({ status: 'active' })).toBeNull();
  });

  it('recurring ids are sub_*; prepay checkout sessions are not', () => {
    expect(isRecurringStripeSubscriptionId('sub_123')).toBe(true);
    expect(isRecurringStripeSubscriptionId('sub_dev_abc')).toBe(true);
    expect(isRecurringStripeSubscriptionId('cs_test_123')).toBe(false);
    expect(isRecurringStripeSubscriptionId(null)).toBe(false);
  });
});
