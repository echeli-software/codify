import { BadRequestException } from '@nestjs/common';
import {
  StripeBillingProvider,
  type StripeClientLike,
} from './stripe.provider.js';
import { createBillingProvider } from './billing-provider.factory.js';
import {
  DevBillingProvider,
  type CheckoutSessionInput,
} from './billing.provider.js';

function mockStripe() {
  const stripe = {
    products: {
      create: jest.fn(async () => ({ id: 'prod_new' })),
      update: jest.fn(async (id: string) => ({ id })),
    },
    prices: {
      create: jest.fn(async () => ({ id: 'price_new' })),
      retrieve: jest.fn(),
      update: jest.fn(async (id: string) => ({ id })),
    },
    customers: {
      list: jest.fn(async () => ({
        data: [] as { id: string; metadata: Record<string, string> }[],
      })),
      create: jest.fn(async () => ({ id: 'cus_created' })),
    },
    checkout: {
      sessions: {
        create: jest.fn(async () => ({
          id: 'cs_1',
          url: 'https://checkout.stripe.com/c/cs_1',
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn(async () => ({
          url: 'https://billing.stripe.com/p/1',
        })),
      },
    },
    subscriptions: {
      retrieve: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    },
    webhooks: { constructEvent: jest.fn() },
  };
  const provider = new StripeBillingProvider(
    stripe as unknown as StripeClientLike,
    'whsec_test',
  );
  return { stripe, provider };
}

const input = (
  over: Partial<CheckoutSessionInput> = {},
): CheckoutSessionInput => ({
  user: { id: 'user-1', email: 'a@codify.app' },
  customerId: null,
  plan: {
    id: 'plan-1',
    name: 'Frontend',
    trialDays: 7,
    stripeProductId: 'prod_1',
  },
  price: {
    id: 'pp-annual',
    stripePriceId: 'price_annual',
    currency: 'BRL',
    amountCents: 47880,
    period: 'ANNUAL',
    maxInstallments: 12,
  },
  paymentMethod: 'card',
  successUrl: 'https://app.codify.app/billing/success',
  cancelUrl: 'https://app.codify.app/subscription',
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastCall = (fn: jest.Mock): any =>
  fn.mock.calls[fn.mock.calls.length - 1][0];

describe('StripeBillingProvider.createCheckoutSession', () => {
  it('card + annual: subscription mode, trial, installments, metadata on the subscription', async () => {
    const { stripe, provider } = mockStripe();
    const res = await provider.createCheckoutSession(
      input({ customerId: 'cus_existing' }),
    );
    const params = lastCall(stripe.checkout.sessions.create);
    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_existing',
      client_reference_id: 'user-1',
      line_items: [{ price: 'price_annual', quantity: 1 }],
      allowed_payment_method_types: ['card'],
      allow_promotion_codes: true,
      cancel_url: 'https://app.codify.app/subscription',
      subscription_data: {
        trial_period_days: 7,
        metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'pp-annual' },
      },
      payment_method_options: { card: { installments: { enabled: true } } },
    });
    expect(params.success_url).toBe(
      'https://app.codify.app/billing/success?session_id={CHECKOUT_SESSION_ID}',
    );
    // Existing customer is reused — no lookup / creation.
    expect(stripe.customers.list).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(res).toEqual({
      sessionId: 'cs_1',
      url: 'https://checkout.stripe.com/c/cs_1',
      customerId: 'cus_existing',
    });
  });

  it('card + monthly: no installments; trialDays 0 → no trial', async () => {
    const { stripe, provider } = mockStripe();
    await provider.createCheckoutSession(
      input({
        plan: {
          id: 'plan-1',
          name: 'F',
          trialDays: 0,
          stripeProductId: 'prod_1',
        },
        price: {
          ...input().price,
          period: 'MONTHLY',
          stripePriceId: 'price_m',
          maxInstallments: null,
        },
      }),
    );
    const params = lastCall(stripe.checkout.sessions.create);
    expect(params.payment_method_options).toBeUndefined();
    expect(params.subscription_data.trial_period_days).toBeUndefined();
  });

  it('card requires a synced Stripe price', async () => {
    const { provider } = mockStripe();
    await expect(
      provider.createCheckoutSession(
        input({ price: { ...input().price, stripePriceId: null } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pix: one-shot annual prepay in payment mode with metadata', async () => {
    const { stripe, provider } = mockStripe();
    await provider.createCheckoutSession(input({ paymentMethod: 'pix' }));
    const params = lastCall(stripe.checkout.sessions.create);
    expect(params).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['pix'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: 47880,
            product: 'prod_1',
          },
        },
      ],
      metadata: {
        userId: 'user-1',
        planId: 'plan-1',
        priceId: 'pp-annual',
        period: 'ANNUAL',
      },
      payment_intent_data: {
        metadata: { userId: 'user-1', planId: 'plan-1', priceId: 'pp-annual' },
      },
      payment_method_options: { pix: { expires_after_seconds: 3600 } },
    });
    expect(params.subscription_data).toBeUndefined();
  });

  it('boleto: payment mode with a voucher expiry; product_data when the plan is unsynced', async () => {
    const { stripe, provider } = mockStripe();
    await provider.createCheckoutSession(
      input({
        paymentMethod: 'boleto',
        plan: {
          id: 'plan-1',
          name: 'Frontend',
          trialDays: 7,
          stripeProductId: null,
        },
      }),
    );
    const params = lastCall(stripe.checkout.sessions.create);
    expect(params.mode).toBe('payment');
    expect(params.allowed_payment_method_types).toEqual(['boleto']);
    expect(params.payment_method_options).toEqual({
      boleto: { expires_after_days: 3 },
    });
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: 'Frontend',
    });
  });

  it('pix / boleto refuse monthly or non-BRL prices', async () => {
    const { provider } = mockStripe();
    await expect(
      provider.createCheckoutSession(
        input({
          paymentMethod: 'pix',
          price: { ...input().price, period: 'MONTHLY' },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      provider.createCheckoutSession(
        input({
          paymentMethod: 'boleto',
          price: { ...input().price, currency: 'USD' },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('customer: reuses one tagged with the user id, else creates one', async () => {
    const { stripe, provider } = mockStripe();
    stripe.customers.list.mockResolvedValueOnce({
      data: [
        { id: 'cus_other', metadata: { userId: 'someone-else' } },
        { id: 'cus_mine', metadata: { userId: 'user-1' } },
      ],
    });
    await provider.createCheckoutSession(input());
    expect(lastCall(stripe.checkout.sessions.create).customer).toBe('cus_mine');

    await provider.createCheckoutSession(input({ customerId: 'cus_dev_abc' }));
    expect(stripe.customers.create).toHaveBeenCalledWith({
      email: 'a@codify.app',
      metadata: { userId: 'user-1' },
    });
    expect(lastCall(stripe.checkout.sessions.create).customer).toBe(
      'cus_created',
    );
  });
});

describe('StripeBillingProvider webhooks', () => {
  it('verifies with constructEvent(rawBody, signature, secret)', () => {
    const { stripe, provider } = mockStripe();
    const evt = { id: 'evt_1', type: 'invoice.paid', data: { object: {} } };
    stripe.webhooks.constructEvent.mockReturnValue(evt);
    const raw = Buffer.from('{}');
    expect(provider.constructWebhookEvent(raw, 't=1,v1=abc')).toBe(evt);
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      raw,
      't=1,v1=abc',
      'whsec_test',
    );
  });

  it('rejects a missing signature without calling Stripe', () => {
    const { stripe, provider } = mockStripe();
    expect(() =>
      provider.constructWebhookEvent(Buffer.from('{}'), undefined),
    ).toThrow(BadRequestException);
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 400', () => {
    const { stripe, provider } = mockStripe();
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error(
        'No signatures found matching the expected signature for payload',
      );
    });
    expect(() =>
      provider.constructWebhookEvent(Buffer.from('{}'), 't=1,v1=bad'),
    ).toThrow(BadRequestException);
  });
});

describe('StripeBillingProvider plans + subscriptions', () => {
  it('syncPlan creates a product and recurring prices (monthly / annual)', async () => {
    const { stripe, provider } = mockStripe();
    stripe.prices.create
      .mockResolvedValueOnce({ id: 'price_m' })
      .mockResolvedValueOnce({ id: 'price_y' });
    const res = await provider.syncPlan({
      plan: {
        id: 'plan-1',
        slug: 'frontend',
        name: 'Frontend',
        description: null,
        stripeProductId: null,
      },
      prices: [
        {
          id: 'pp-m',
          currency: 'BRL',
          amountCents: 3990,
          period: 'MONTHLY',
          maxInstallments: null,
          stripePriceId: null,
          isActive: true,
        },
        {
          id: 'pp-y',
          currency: 'BRL',
          amountCents: 38304,
          period: 'ANNUAL',
          maxInstallments: 12,
          stripePriceId: null,
          isActive: true,
        },
      ],
    });
    expect(stripe.products.create).toHaveBeenCalledWith({
      name: 'Frontend',
      metadata: { planId: 'plan-1', slug: 'frontend' },
    });
    expect(stripe.prices.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        product: 'prod_new',
        currency: 'brl',
        unit_amount: 3990,
        recurring: { interval: 'month' },
      }),
    );
    expect(stripe.prices.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        unit_amount: 38304,
        recurring: { interval: 'year' },
      }),
    );
    expect(res).toEqual({
      stripeProductId: 'prod_new',
      prices: [
        { id: 'pp-m', stripePriceId: 'price_m' },
        { id: 'pp-y', stripePriceId: 'price_y' },
      ],
    });
  });

  it('syncPlan keeps an unchanged price and replaces a changed one (prices are immutable)', async () => {
    const { stripe, provider } = mockStripe();
    stripe.prices.retrieve
      .mockResolvedValueOnce({
        id: 'price_same',
        currency: 'brl',
        unit_amount: 3990,
        recurring: { interval: 'month' },
        product: 'prod_1',
        active: true,
      })
      .mockResolvedValueOnce({
        id: 'price_old',
        currency: 'brl',
        unit_amount: 40000,
        recurring: { interval: 'year' },
        product: 'prod_1',
        active: true,
      });
    stripe.prices.create.mockResolvedValueOnce({ id: 'price_replacement' });
    const res = await provider.syncPlan({
      plan: {
        id: 'plan-1',
        slug: 'f',
        name: 'F',
        description: 'd',
        stripeProductId: 'prod_1',
      },
      prices: [
        {
          id: 'pp-m',
          currency: 'BRL',
          amountCents: 3990,
          period: 'MONTHLY',
          maxInstallments: null,
          stripePriceId: 'price_same',
          isActive: true,
        },
        {
          id: 'pp-y',
          currency: 'BRL',
          amountCents: 38304,
          period: 'ANNUAL',
          maxInstallments: 12,
          stripePriceId: 'price_old',
          isActive: true,
        },
      ],
    });
    expect(stripe.products.update).toHaveBeenCalledWith(
      'prod_1',
      expect.objectContaining({ description: 'd' }),
    );
    expect(stripe.prices.update).toHaveBeenCalledWith('price_old', {
      active: false,
    });
    expect(res.prices).toEqual([
      { id: 'pp-m', stripePriceId: 'price_same' },
      { id: 'pp-y', stripePriceId: 'price_replacement' },
    ]);
  });

  it('cancel at period end / resume / cancel now go through the Subscriptions API', async () => {
    const { stripe, provider } = mockStripe();
    const sub = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: true,
      items: {
        data: [
          {
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
            price: { id: 'price_m' },
          },
        ],
      },
      metadata: { userId: 'user-1' },
    };
    stripe.subscriptions.update.mockResolvedValue(sub);
    const snap = await provider.setCancelAtPeriodEnd('sub_1', true);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      cancel_at_period_end: true,
    });
    expect(snap).toMatchObject({
      id: 'sub_1',
      cancelAtPeriodEnd: true,
      priceIds: ['price_m'],
    });
    expect(snap?.currentPeriodEnd?.getTime()).toBe(1_802_592_000_000);

    stripe.subscriptions.cancel.mockResolvedValue({
      ...sub,
      status: 'canceled',
    });
    expect((await provider.cancelSubscriptionNow('sub_1'))?.status).toBe(
      'canceled',
    );
  });

  it('retrieveSubscription returns null for a missing subscription, rethrows other errors', async () => {
    const { stripe, provider } = mockStripe();
    stripe.subscriptions.retrieve.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'resource_missing' }),
    );
    await expect(provider.retrieveSubscription('sub_x')).resolves.toBeNull();
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error('network'));
    await expect(provider.retrieveSubscription('sub_x')).rejects.toThrow(
      'network',
    );
  });

  it('portal session for the customer', async () => {
    const { stripe, provider } = mockStripe();
    await expect(
      provider.createPortalSession({
        user: { id: 'u' },
        customerId: 'cus_1',
        returnUrl: 'https://x/s',
      }),
    ).resolves.toEqual({ url: 'https://billing.stripe.com/p/1' });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://x/s',
    });
  });
});

describe('createBillingProvider', () => {
  const fakeClient = () => mockStripe().stripe as unknown as StripeClientLike;

  it('STRIPE_SECRET_KEY + webhook secret → Stripe provider', () => {
    const p = createBillingProvider(
      { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' },
      fakeClient,
    );
    expect(p.mode).toBe('stripe');
  });

  it('STRIPE_SECRET_KEY without a webhook secret refuses to start', () => {
    expect(() =>
      createBillingProvider({ STRIPE_SECRET_KEY: 'sk_test_x' }, fakeClient),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('dev provider outside production; production without Stripe throws', () => {
    expect(createBillingProvider({})).toBeInstanceOf(DevBillingProvider);
    expect(() => createBillingProvider({ NODE_ENV: 'production' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
  });

  it('constructs the real SDK client from the key', () => {
    const p = createBillingProvider({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
    });
    expect(p).toBeInstanceOf(StripeBillingProvider);
  });
});
