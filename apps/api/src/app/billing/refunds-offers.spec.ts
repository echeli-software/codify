import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import { DevBillingProvider } from './billing.provider.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { RefundsService, oneMonthCents } from './refunds.service.js';
import { FakeBillingPrisma } from './testing/fake-billing-prisma.js';
import { makeWebhookService } from './testing/fake-billing-deps.js';
import { trialReminderKey } from './trial-reminder.js';
import {
  WinbackOfferService,
  winbackConfigFromEnv,
  winbackUsageKey,
} from './winback-offer.service.js';

const DAY = 86_400;
const DAY_MS = DAY * 1000;
const nowSec = () => Math.floor(Date.now() / 1000);
let seq = 0;
const evt = (
  type: string,
  object: Record<string, unknown>,
  created = nowSec(),
) => ({ id: `evt_r${++seq}`, type, created, data: { object } });

const student: ApiUser = {
  userId: 'user-1',
  clerkId: 'c',
  email: 's@x.y',
  role: 'STUDENT',
  displayName: 'S',
};
const support: ApiUser = { ...student, userId: 'sup-1', role: 'SUPPORT' };
const admin: ApiUser = { ...student, userId: 'adm-1', role: 'ADMIN' };

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

function webhookCtx() {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1', coins: 50, timezone: 'UTC' });
  prisma.state.plans.push({ id: 'plan-1', name: 'Pro', deletedAt: null });
  const provider = new DevBillingProvider('k');
  const deps = makeWebhookService(prisma, provider, {
    config: { 'billing.firstPaymentBonusCoins': 300 },
  });
  const send = (e: { id: string }) =>
    deps.svc.handleStripe(Buffer.from(JSON.stringify(e)), e, undefined);
  return { prisma, provider, send, ...deps };
}

describe('dev refund → the charge.refunded webhook path', () => {
  it('refunds the Payment, ends access and claws the bonus back — idempotently', async () => {
    const ctx = webhookCtx();
    await ctx.send(
      evt(
        'customer.subscription.created',
        {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          current_period_start: nowSec() - 3600,
          current_period_end: nowSec() + 30 * DAY,
          metadata: { userId: 'user-1', planId: 'plan-1' },
        },
        nowSec() - 600,
      ),
    );
    await ctx.send(
      evt('invoice.paid', {
        id: 'in_1',
        subscription: 'sub_1',
        amount_paid: 2990,
        currency: 'brl',
        billing_reason: 'subscription_create',
      }),
    );
    const payment = ctx.prisma.state.payments[0];
    expect(payment).toMatchObject({ status: 'PAID', amountCents: 2990 });

    const input = {
      externalId: 'in_1',
      amountCents: 2990,
      payment: {
        id: payment.id,
        userId: 'user-1',
        amountCents: 2990,
        refundedCents: 0,
        currency: 'BRL',
        paidAt: new Date(),
        stripeSubscriptionId: 'sub_1',
      },
      idempotencyKey: `refund:${payment.id}:0:2990`,
      metadata: {},
    };
    const res = await ctx.provider.refundPayment(input);
    expect(res.simulatedEvent?.type).toBe('charge.refunded');
    await ctx.svc.processEvent(res.simulatedEvent!);

    expect(ctx.prisma.state.payments[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 2990,
    });
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('CANCELED');
    expect(
      (ctx.prisma.state.users[0] as unknown as { coins: number }).coins,
    ).toBe(50);

    // Same refund again (same key → same event id): a duplicate, no change.
    const again = await ctx.provider.refundPayment(input);
    expect(again.simulatedEvent?.id).toBe(res.simulatedEvent?.id);
    const dup = await ctx.svc.processEvent(again.simulatedEvent!);
    expect(dup.duplicate).toBe(true);
  });
});

describe('customer.subscription.trial_will_end', () => {
  const trialSub = (endsInSec: number) => ({
    id: 'sub_t',
    customer: 'cus_1',
    status: 'trialing',
    current_period_start: nowSec() - 5 * DAY,
    current_period_end: nowSec() + endsInSec,
    trial_end: nowSec() + endsInSec,
    cancel_at_period_end: false,
    metadata: { userId: 'user-1', planId: 'plan-1' },
  });

  it('reminds now when the trial ends within 2 days, once per trial end', async () => {
    const ctx = webhookCtx();
    await ctx.send(evt('customer.subscription.trial_will_end', trialSub(DAY)));
    expect(ctx.push.sendToUser.calls).toHaveLength(1);
    const [userId, content, opts] = ctx.push.sendToUser.calls[0] as [
      string,
      (u: { locale: string }) => { title: string; data: object },
      { kind: string },
    ];
    expect(userId).toBe('user-1');
    expect(opts.kind).toBe('BILLING');
    expect(content({ locale: 'en-US' }).title).toBe(
      'Your free trial ends soon',
    );
    expect(content({ locale: 'pt-BR' }).data).toMatchObject({
      type: 'billing_trial_ending',
    });
    // A replay under a new event id doesn't remind twice.
    await ctx.send(evt('customer.subscription.trial_will_end', trialSub(DAY)));
    expect(ctx.push.sendToUser.calls).toHaveLength(1);
  });

  it('leaves 3-days-ahead events to the hourly job (no reminder yet)', async () => {
    const ctx = webhookCtx();
    await ctx.send(
      evt('customer.subscription.trial_will_end', trialSub(3 * DAY)),
    );
    expect(ctx.push.sendToUser.calls).toHaveLength(0);
    expect(ctx.prisma.state.subscriptions[0]['status']).toBe('TRIALING');
  });
});

describe('BillingJobsService.sendTrialReminders', () => {
  it('notifies trials ending within 2 days and skips ones already reminded', async () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const endsAt = new Date(now.getTime() + DAY_MS);
    const claimed = new Set<string>([trialReminderKey('s2', endsAt)]);
    const prisma = {
      subscription: {
        findMany: jest.fn(async () => [
          {
            id: 's1',
            userId: 'u1',
            trialEndsAt: endsAt,
            plan: { name: 'Pro' },
            user: { timezone: 'UTC' },
          },
          {
            id: 's2',
            userId: 'u2',
            trialEndsAt: endsAt,
            plan: { name: 'Pro' },
            user: { timezone: 'UTC' },
          },
        ]),
      },
      idempotencyRecord: {
        createMany: jest.fn(async ({ data }: { data: { key: string }[] }) => {
          const fresh = data.filter((d) => !claimed.has(d.key));
          fresh.forEach((d) => claimed.add(d.key));
          return { count: fresh.length };
        }),
        deleteMany: jest.fn(),
      },
    };
    const notify = jest.fn(async () => ({ status: 'ok' }));
    const jobs = new BillingJobsService(
      prisma as never,
      {} as never,
      { notify } as never,
    );
    const res = await jobs.sendTrialReminders(now);
    expect(res).toEqual({ candidates: 2, notified: 1, alreadyReminded: 1 });
    expect(notify).toHaveBeenCalledWith('u1', expect.any(Function), { now });
    const where = (
      prisma.subscription.findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      status: 'TRIALING',
      cancelAtPeriodEnd: false,
    });
  });
});

// ─── RefundsService rules ────────────────────────────────────────────────

function refundsCtx(over: {
  payments?: Record<string, unknown>[];
  storeSub?: boolean;
  used?: boolean;
  windowDays?: number;
}) {
  const payments = over.payments ?? [];
  const records = new Set<string>(
    over.used ? ['billing_refund:self:user-1'] : [],
  );
  const subs: Record<string, unknown>[] = [
    { id: 'sub-row', status: 'ACTIVE', stripeSubscriptionId: 'sub_1' },
  ];
  const prisma = {
    payment: {
      findFirst: jest.fn(async () => payments[0] ?? null),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          payments.find((p) => p['id'] === where.id) ?? null,
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => {
          const p = payments.find((x) => x['id'] === where.id);
          return { status: p?.['status'], refundedCents: p?.['refundedCents'] };
        },
      ),
    },
    subscription: {
      findFirst: jest.fn(async () => (over.storeSub ? { id: 'ios' } : null)),
      findUnique: jest.fn(async () => subs[0]),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        records.has(where.key) ? { key: where.key } : null,
      ),
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (records.has(data.key))
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          });
        records.add(data.key);
        return data;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        records.delete(where.key);
        return { count: 1 };
      }),
    },
  };
  const provider = {
    mode: 'stripe',
    refundPayment: jest.fn(async () => ({
      refundId: 're_1',
      status: 'succeeded',
    })),
  };
  const webhook = { processEvent: jest.fn() };
  const billing = {
    endNow: jest.fn(async (s: Record<string, unknown>) => {
      s['status'] = 'CANCELED';
      return s;
    }),
  };
  const config = { get: jest.fn(async () => over.windowDays ?? 7) };
  const svc = new RefundsService(
    prisma as never,
    provider as never,
    webhook as never,
    billing as never,
    config as never,
  );
  return { svc, prisma, provider, billing, records, subs };
}

const plan = {
  name: 'Pro',
  prices: [
    { currency: 'BRL', period: 'MONTHLY', amountCents: 3990 },
    { currency: 'BRL', period: 'ANNUAL', amountCents: 39900 },
  ],
};
const paid = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  userId: 'user-1',
  provider: 'STRIPE',
  externalId: 'in_1',
  amountCents: 39900,
  refundedCents: 0,
  currency: 'BRL',
  status: 'PAID',
  paidAt: new Date(Date.now() - 2 * DAY_MS),
  subscription: {
    id: 'sub-row',
    status: 'ACTIVE',
    stripeSubscriptionId: 'sub_1',
    plan,
  },
  ...over,
});

describe('RefundsService — self-serve', () => {
  it('eligible inside the window; refunds in full, ends access, once per account', async () => {
    const ctx = refundsCtx({ payments: [paid()] });
    const view = await ctx.svc.eligibility('user-1');
    expect(view).toMatchObject({ eligible: true, reason: null, windowDays: 7 });
    const out = await ctx.svc.requestSelfRefund(student);
    expect(ctx.provider.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'in_1',
        amountCents: 39900,
        idempotencyKey: 'refund:pay-1:0:39900',
      }),
    );
    expect(ctx.billing.endNow).toHaveBeenCalled();
    expect(out).toMatchObject({ paymentId: 'pay-1', accessEnded: true });
    await expect(ctx.svc.requestSelfRefund(student)).rejects.toMatchObject({
      response: { code: 'REFUND_NOT_ELIGIBLE', reason: 'ALREADY_USED' },
    });
  });

  it('refuses outside the window, after a refund, and for store purchases', async () => {
    const late = refundsCtx({
      payments: [paid({ paidAt: new Date(Date.now() - 9 * DAY_MS) })],
    });
    expect((await late.svc.eligibility('user-1')).reason).toBe('WINDOW_PASSED');
    const refunded = refundsCtx({ payments: [paid({ refundedCents: 100 })] });
    expect((await refunded.svc.eligibility('user-1')).reason).toBe(
      'ALREADY_REFUNDED',
    );
    const store = refundsCtx({ storeSub: true });
    await expect(store.svc.requestSelfRefund(student)).rejects.toMatchObject({
      response: { code: 'STORE_REFUND' },
    });
  });

  it('releases the once-per-account claim when the provider fails', async () => {
    const ctx = refundsCtx({ payments: [paid()] });
    ctx.provider.refundPayment.mockRejectedValueOnce(
      new Error('card_declined'),
    );
    await expect(ctx.svc.requestSelfRefund(student)).rejects.toMatchObject({
      response: { code: 'REFUND_FAILED' },
    });
    expect(ctx.records.has('billing_refund:self:user-1')).toBe(false);
  });
});

describe('RefundsService — staff', () => {
  it('SUPPORT is capped at one month of the plan (cumulative), ADMIN is not', async () => {
    const ctx = refundsCtx({ payments: [paid()] });
    await expect(
      ctx.svc.staffRefund(support, 'pay-1', 5000),
    ).rejects.toMatchObject({
      response: { code: 'REFUND_CAP_EXCEEDED', capCents: 3990 },
    });
    const ok = await ctx.svc.staffRefund(support, 'pay-1', 3990);
    expect(ok.capCents).toBe(3990);

    const prior = refundsCtx({ payments: [paid({ refundedCents: 3000 })] });
    await expect(
      prior.svc.staffRefund(support, 'pay-1', 1000),
    ).rejects.toMatchObject({ response: { code: 'REFUND_CAP_EXCEEDED' } });

    const adm = refundsCtx({ payments: [paid()] });
    const full = await adm.svc.staffRefund(admin, 'pay-1', undefined);
    expect(full.refund.amountCents).toBe(39900);
    expect(full.capCents).toBeNull();
    expect(adm.billing.endNow).not.toHaveBeenCalled();
  });

  it('refuses store payments, overshoots and a concurrent refund of the same state', async () => {
    const store = refundsCtx({ payments: [paid({ provider: 'APPLE' })] });
    await expect(
      store.svc.staffRefund(admin, 'pay-1', 100),
    ).rejects.toMatchObject({ response: { code: 'STORE_REFUND' } });

    const ctx = refundsCtx({ payments: [paid({ refundedCents: 39000 })] });
    await expect(
      ctx.svc.staffRefund(admin, 'pay-1', 1000),
    ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_REMAINING' } });

    ctx.records.add('billing_refund:pay-1:39000');
    await expect(
      ctx.svc.staffRefund(admin, 'pay-1', 900),
    ).rejects.toMatchObject({ response: { code: 'REFUND_IN_PROGRESS' } });
  });

  it('one month = the monthly price in the payment currency, else annual ÷ 12', () => {
    expect(oneMonthCents(paid() as never)).toBe(3990);
    expect(
      oneMonthCents({
        currency: 'BRL',
        subscription: {
          plan: {
            prices: [{ currency: 'BRL', period: 'ANNUAL', amountCents: 12000 }],
          },
        },
      } as never),
    ).toBe(1000);
    expect(
      oneMonthCents({ currency: 'USD', subscription: null } as never),
    ).toBe(0);
  });
});

// ─── Win-back offer ──────────────────────────────────────────────────────

describe('WinbackOfferService', () => {
  function ctx(opts: {
    sent?: boolean;
    live?: boolean;
    used?: boolean;
    mode?: 'dev' | 'stripe';
  }) {
    const prisma = {
      notification: {
        findFirst: jest.fn(async () =>
          opts.sent ? { createdAt: new Date(Date.now() - DAY_MS) } : null,
        ),
      },
      subscription: {
        findFirst: jest.fn(async () => (opts.live ? { id: 's' } : null)),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async () => (opts.used ? { key: 'k' } : null)),
      },
    };
    return new WinbackOfferService(
      prisma as never,
      { mode: opts.mode ?? 'dev' } as never,
    );
  }

  it('eligible only after the day-30 offer, while free, and never used', async () => {
    expect(await ctx({ sent: true }).status('u')).toMatchObject({
      eligible: true,
      appliesTo: 'ANNUAL',
      percentOff: 20,
    });
    expect((await ctx({}).status('u')).reason).toBe('NO_OFFER');
    expect((await ctx({ sent: true, live: true }).status('u')).reason).toBe(
      'SUBSCRIBED',
    );
    expect((await ctx({ sent: true, used: true }).status('u')).reason).toBe(
      'USED',
    );
    // Stripe without a configured coupon: no offer.
    expect((await ctx({ sent: true, mode: 'stripe' }).status('u')).reason).toBe(
      'NOT_CONFIGURED',
    );
  });

  it('discountFor: 409 when not eligible, 400 for a monthly price', async () => {
    await expect(ctx({}).discountFor('u', 'ANNUAL')).rejects.toMatchObject({
      response: { code: 'OFFER_NOT_AVAILABLE', reason: 'NO_OFFER' },
    });
    await expect(
      ctx({ sent: true }).discountFor('u', 'MONTHLY'),
    ).rejects.toMatchObject({ response: { code: 'OFFER_NOT_APPLICABLE' } });
    expect(await ctx({ sent: true }).discountFor('u', 'ANNUAL')).toMatchObject({
      offer: 'winback',
      percentOff: 20,
    });
  });

  it('reads its config from the environment', () => {
    expect(
      winbackConfigFromEnv({
        STRIPE_WINBACK_COUPON: 'co_x',
        WINBACK_PERCENT_OFF: '35',
        WINBACK_OFFER_DAYS: '7',
      }),
    ).toEqual({
      couponId: 'co_x',
      promotionCodeId: null,
      percentOff: 35,
      validDays: 7,
    });
    expect(winbackConfigFromEnv({ WINBACK_PERCENT_OFF: '95' }).percentOff).toBe(
      20,
    );
    expect(winbackUsageKey('u1')).toBe('winback_offer:u1');
  });

  it('the webhook records usage when a discounted subscription is created', async () => {
    const w = webhookCtx();
    await w.send(
      evt('customer.subscription.created', {
        id: 'sub_w',
        customer: 'cus_1',
        status: 'active',
        current_period_start: nowSec(),
        current_period_end: nowSec() + 365 * DAY,
        metadata: { userId: 'user-1', planId: 'plan-1', offer: 'winback' },
      }),
    );
    expect(w.prisma.state.idempotency.has(winbackUsageKey('user-1'))).toBe(
      true,
    );
  });
});
