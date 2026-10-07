import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { BillingService } from './billing.service.js';
import {
  BillingAdminService,
  SUPPORT_MAX_GRANT_DAYS,
} from './billing-admin.service.js';
import {
  DevBillingProvider,
  type BillingProvider,
} from './billing.provider.js';

const DAY_MS = 86_400_000;

const student: ApiUser = {
  userId: 'user-1',
  clerkId: 'c',
  email: 's@codify.app',
  role: 'STUDENT',
  displayName: 'S',
};
const support: ApiUser = { ...student, userId: 'support-1', role: 'SUPPORT' };
const admin: ApiUser = { ...student, userId: 'admin-1', role: 'ADMIN' };

function sub(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'sub-row-1',
    userId: 'user-1',
    planId: 'plan-1',
    source: 'STRIPE_WEB',
    stripeSubscriptionId: 'sub_123',
    stripeCustomerId: 'cus_1',
    revenueCatUserId: null,
    storeTransactionId: null,
    storeProductId: null,
    status: 'ACTIVE',
    currentPeriodStart: new Date(now - DAY_MS),
    currentPeriodEnd: new Date(now + 20 * DAY_MS),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEndsAt: null,
    pastDueSince: null,
    createdAt: new Date(now - DAY_MS),
    updatedAt: new Date(now - DAY_MS),
    plan: { name: 'Frontend' },
    ...over,
  };
}

function makePrisma() {
  return {
    planPrice: { findUnique: jest.fn(), findFirst: jest.fn() },
    plan: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(async () => ({ id: 'user-1' })) },
    subscription: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...sub(),
        ...data,
      })),
      upsert: jest.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
          ...sub(),
          ...create,
        }),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...sub(),
        id: 'granted',
        ...data,
      })),
    },
  };
}

const access = { pastDueGraceDays: jest.fn(async () => 3) };

function stripeLikeProvider(): BillingProvider {
  return {
    mode: 'stripe',
    syncPlan: jest.fn(),
    createCheckoutSession: jest.fn(async () => ({
      sessionId: 'cs_1',
      url: 'https://x',
      customerId: 'cus_1',
    })),
    createPortalSession: jest.fn(),
    constructWebhookEvent: jest.fn(),
    retrieveSubscription: jest.fn(),
    setCancelAtPeriodEnd: jest.fn(async (id: string, cancel: boolean) => ({
      id,
      customerId: 'cus_1',
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: cancel,
      trialEnd: null,
      canceledAt: null,
      endedAt: null,
      priceIds: [],
      metadata: {},
    })),
    cancelSubscriptionNow: jest.fn(async () => null),
  };
}

describe('BillingService — dev checkout hardening', () => {
  it('403 whenever the provider is not the dev provider', async () => {
    const prisma = makePrisma();
    // Even a provider that *claims* mode "dev" is refused unless it is the dev provider.
    const impostor = {
      ...stripeLikeProvider(),
      mode: 'dev',
    } as unknown as BillingProvider;
    for (const provider of [stripeLikeProvider(), impostor]) {
      const svc = new BillingService(
        prisma as never,
        access as never,
        provider,
      );
      await expect(
        svc.completeDevCheckout(student, 'cs_dev_x.y'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('rejects a forged / foreign session id and another user’s session', async () => {
    const prisma = makePrisma();
    const dev = new DevBillingProvider('k1');
    const svc = new BillingService(prisma as never, access as never, dev);
    const other = new DevBillingProvider('k2');
    const { sessionId } = await other.createCheckoutSession(
      checkoutInput('user-1'),
    );
    await expect(
      svc.completeDevCheckout(student, sessionId),
    ).rejects.toBeInstanceOf(BadRequestException);

    const mine = await dev.createCheckoutSession(checkoutInput('user-2'));
    await expect(
      svc.completeDevCheckout(student, mine.sessionId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('completes a valid session: card → renewing trial; pix → non-renewing year', async () => {
    const prisma = makePrisma();
    prisma.planPrice.findFirst.mockResolvedValue({
      id: 'pp',
      period: 'ANNUAL',
      plan: { name: 'F' },
    });
    const dev = new DevBillingProvider('k1');
    const svc = new BillingService(prisma as never, access as never, dev);

    const card = await dev.createCheckoutSession(checkoutInput('user-1'));
    const r1 = await svc.completeDevCheckout(student, card.sessionId);
    expect(r1.status).toBe('TRIALING');
    expect(
      prisma.subscription.upsert.mock.calls[0][0].create.cancelAtPeriodEnd,
    ).toBe(false);

    const pix = await dev.createCheckoutSession({
      ...checkoutInput('user-1'),
      paymentMethod: 'pix',
    });
    const r2 = await svc.completeDevCheckout(student, pix.sessionId);
    expect(r2.status).toBe('ACTIVE');
    expect(r2.cancelAtPeriodEnd).toBe(true);
    expect(r2.renews).toBe(false);
  });
});

describe('BillingService — checkout', () => {
  it('only active prices of active plans are purchasable', async () => {
    const prisma = makePrisma();
    const svc = new BillingService(
      prisma as never,
      access as never,
      stripeLikeProvider(),
    );
    prisma.planPrice.findUnique.mockResolvedValue({
      id: 'pp',
      isActive: false,
      plan: { isActive: true, deletedAt: null },
    });
    await expect(
      svc.createCheckout(student, { planPriceId: 'pp' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reuses the stripeCustomerId from the user’s earlier subscription', async () => {
    const prisma = makePrisma();
    const provider = stripeLikeProvider();
    const svc = new BillingService(prisma as never, access as never, provider);
    prisma.planPrice.findUnique.mockResolvedValue({
      id: 'pp',
      isActive: true,
      stripePriceId: 'price_1',
      currency: 'BRL',
      amountCents: 3990,
      period: 'MONTHLY',
      maxInstallments: null,
      plan: {
        id: 'plan-1',
        name: 'F',
        trialDays: 7,
        isActive: true,
        deletedAt: null,
        stripeProductId: 'prod',
      },
    });
    prisma.subscription.findFirst.mockResolvedValue({
      stripeCustomerId: 'cus_known',
    });
    await svc.createCheckout(student, { planPriceId: 'pp' });
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_known',
        paymentMethod: 'card',
      }),
    );
    // PIX on a monthly price is refused before reaching the provider.
    await expect(
      svc.createCheckout(student, { planPriceId: 'pp', paymentMethod: 'pix' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BillingService — cancel / resume', () => {
  it('cancel sets cancel_at_period_end on Stripe and mirrors it; access continues', async () => {
    const prisma = makePrisma();
    const provider = stripeLikeProvider();
    const svc = new BillingService(prisma as never, access as never, provider);
    prisma.subscription.findFirst.mockResolvedValue(sub());
    const res = await svc.cancelMine(student, {});
    expect(provider.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', true);
    expect(res.cancelAtPeriodEnd).toBe(true);
    expect(res.grantsAccess).toBe(true);
    expect(res.renews).toBe(false);
  });

  it('dev provider: cancel just flips the flag', async () => {
    const prisma = makePrisma();
    const svc = new BillingService(
      prisma as never,
      access as never,
      new DevBillingProvider('k'),
    );
    prisma.subscription.findFirst.mockResolvedValue(
      sub({ stripeSubscriptionId: 'sub_dev_x' }),
    );
    const res = await svc.cancelMine(student, {});
    expect(res.cancelAtPeriodEnd).toBe(true);
    expect(
      prisma.subscription.update.mock.calls[0][0].data.canceledAt,
    ).toBeInstanceOf(Date);
  });

  it('store subscriptions must be changed in the store', async () => {
    const prisma = makePrisma();
    const svc = new BillingService(
      prisma as never,
      access as never,
      stripeLikeProvider(),
    );
    prisma.subscription.findFirst.mockResolvedValue(
      sub({ source: 'APPLE_IAP', stripeSubscriptionId: null }),
    );
    await expect(svc.cancelMine(student, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cannot cancel an already-ended subscription', async () => {
    const prisma = makePrisma();
    const svc = new BillingService(
      prisma as never,
      access as never,
      stripeLikeProvider(),
    );
    prisma.subscription.findFirst.mockResolvedValue(
      sub({ status: 'CANCELED' }),
    );
    await expect(
      svc.cancelMine(student, { subscriptionId: 'sub-row-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resume clears the pending cancellation on Stripe', async () => {
    const prisma = makePrisma();
    const provider = stripeLikeProvider();
    const svc = new BillingService(prisma as never, access as never, provider);
    prisma.subscription.findFirst.mockResolvedValue(
      sub({ cancelAtPeriodEnd: true }),
    );
    const res = await svc.resumeMine(student, {});
    expect(provider.setCancelAtPeriodEnd).toHaveBeenCalledWith(
      'sub_123',
      false,
    );
    expect(res.cancelAtPeriodEnd).toBe(false);
    expect(
      prisma.subscription.update.mock.calls[0][0].data.canceledAt,
    ).toBeNull();
  });

  it('a one-shot prepay cannot be resumed (nothing renews)', async () => {
    const prisma = makePrisma();
    const svc = new BillingService(
      prisma as never,
      access as never,
      stripeLikeProvider(),
    );
    prisma.subscription.findFirst.mockResolvedValue(
      sub({ cancelAtPeriodEnd: true, stripeSubscriptionId: 'cs_test_1' }),
    );
    await expect(svc.resumeMine(student, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BillingAdminService', () => {
  function admin$(provider: BillingProvider = stripeLikeProvider()) {
    const prisma = makePrisma();
    const billing = new BillingService(
      prisma as never,
      access as never,
      provider,
    );
    return {
      prisma,
      provider,
      svc: new BillingAdminService(prisma as never, access as never, billing),
    };
  }

  it(`SUPPORT grants are capped at ${SUPPORT_MAX_GRANT_DAYS} days; ADMIN is not`, async () => {
    const { prisma, svc } = admin$();
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1', name: 'F' });
    await expect(
      svc.grant(support, 'user-1', { planId: 'plan-1', durationDays: 32 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const ok = await svc.grant(support, 'user-1', {
      planId: 'plan-1',
      durationDays: 31,
    });
    expect(ok).toMatchObject({
      source: 'ADMIN_GRANT',
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      grantsAccess: true,
    });
    const end =
      new Date(ok.currentPeriodEnd).getTime() -
      new Date(ok.currentPeriodStart).getTime();
    expect(end).toBe(31 * DAY_MS);

    await expect(
      svc.grant(admin, 'user-1', { planId: 'plan-1', durationDays: 365 }),
    ).resolves.toBeDefined();
  });

  it('grant 404s for unknown users / plans', async () => {
    const { prisma, svc } = admin$();
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      svc.grant(admin, 'ghost', { planId: 'p', durationDays: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.plan.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.grant(admin, 'user-1', { planId: 'p', durationDays: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('immediate cancel ends the Stripe subscription and revokes access now', async () => {
    const { prisma, provider, svc } = admin$();
    prisma.subscription.findUnique.mockResolvedValue(sub());
    const res = await svc.cancel('sub-row-1', { mode: 'immediate' });
    expect(provider.cancelSubscriptionNow).toHaveBeenCalledWith('sub_123');
    expect(res.status).toBe('CANCELED');
    expect(res.grantsAccess).toBe(false);
  });

  it('period-end cancel keeps access until the period ends', async () => {
    const { prisma, provider, svc } = admin$();
    prisma.subscription.findUnique.mockResolvedValue(sub());
    const res = await svc.cancel('sub-row-1', { mode: 'period_end' });
    expect(provider.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', true);
    expect(res.grantsAccess).toBe(true);
    expect(res.cancelAtPeriodEnd).toBe(true);
  });

  it('admin grants are canceled locally (no provider call)', async () => {
    const { prisma, provider, svc } = admin$();
    prisma.subscription.findUnique.mockResolvedValue(
      sub({
        source: 'ADMIN_GRANT',
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      }),
    );
    await svc.cancel('sub-row-1', { mode: 'immediate' });
    expect(provider.cancelSubscriptionNow).not.toHaveBeenCalled();
  });
});

function checkoutInput(userId: string) {
  return {
    user: { id: userId, email: 'x@y' },
    customerId: null,
    plan: { id: 'plan-1', name: 'F', trialDays: 7, stripeProductId: null },
    price: {
      id: 'pp',
      stripePriceId: null,
      currency: 'BRL',
      amountCents: 47880,
      period: 'ANNUAL' as const,
      maxInstallments: 12,
    },
    paymentMethod: 'card' as const,
    successUrl: 'http://localhost/s',
    cancelUrl: 'http://localhost/c',
  };
}
