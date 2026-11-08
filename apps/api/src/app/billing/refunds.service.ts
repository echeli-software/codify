import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Payment, PaymentStatus } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillingService } from './billing.service.js';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  type RefundResult,
} from './billing.provider.js';
import { WebhookService } from './webhook.service.js';

const DAY_MS = 86_400_000;
const REFUND_SCOPE = 'billing_refund';
const LIVE = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

export type SelfRefundIneligibleReason =
  | 'NO_PAYMENT'
  | 'STORE_PURCHASE'
  | 'WINDOW_PASSED'
  | 'ALREADY_USED'
  | 'ALREADY_REFUNDED';

/** GET /billing/refund-eligibility. */
export interface RefundEligibilityView {
  eligible: boolean;
  reason: SelfRefundIneligibleReason | null;
  /** `billing.refundWindowDays` (admin-editable, docs/09 §5). */
  windowDays: number;
  /** The first payment the self-serve refund applies to. */
  payment: {
    id: string;
    amountCents: number;
    currency: string;
    paidAt: string;
    planName: string | null;
  } | null;
  /** Last moment the refund can be requested (ISO). */
  deadline: string | null;
}

export interface RefundOutcome {
  paymentId: string;
  refund: {
    id: string;
    status: string;
    amountCents: number;
    currency: string;
  };
  before: { status: PaymentStatus; refundedCents: number };
  /**
   * The Payment as stored now. With Stripe the `charge.refunded` webhook
   * updates it a moment later; the dev provider applies it inline.
   */
  after: { status: PaymentStatus; refundedCents: number };
  /** The subscription the payment paid for was ended (self-serve: always). */
  accessEnded: boolean;
}

type PaymentWithPlan = Payment & {
  subscription: {
    id: string;
    status: string;
    stripeSubscriptionId: string | null;
    plan: {
      name: string;
      prices: { currency: string; period: string; amountCents: number }[];
    };
  } | null;
};

/**
 * Refunds (docs/09 §5 "Refunds", docs/14 §2, docs/04 Users):
 *
 *  - Self-serve: a student may refund their FIRST web payment within
 *    `billing.refundWindowDays` of paying, once per account. The refund is
 *    full and access ends now (the subscription is canceled, at Stripe too).
 *  - SUPPORT: up to one month of the plan (the plan's monthly price in the
 *    payment's currency, else annual ÷ 12), cumulative per payment.
 *  - ADMIN: any amount up to what is left.
 *
 * Refunds are issued at the provider; the Payment row, the access change
 * and the first-payment-bonus claw-back are applied by the `charge.refunded`
 * webhook path (WebhookService) — idempotent, so a replay is harmless. The
 * dev provider returns that event and it is applied inline. App Store /
 * Google Play purchases are refunded by Apple / Google, never here.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
    private readonly webhook: WebhookService,
    private readonly subscriptions: BillingService,
    private readonly config: GamificationConfigService,
  ) {}

  // ─── Self-serve ──────────────────────────────────────────────────────

  async eligibility(
    userId: string,
    now = new Date(),
  ): Promise<RefundEligibilityView> {
    const windowDays = await this.config.get('billing.refundWindowDays');
    const [first, store, used] = await Promise.all([
      this.prisma.payment.findFirst({
        where: { userId, provider: 'STRIPE', paidAt: { not: null } },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          subscription: { select: { plan: { select: { name: true } } } },
        },
      }),
      this.prisma.subscription.findFirst({
        where: { userId, source: { in: ['APPLE_IAP', 'GOOGLE_PLAY'] } },
        select: { id: true },
      }),
      this.prisma.idempotencyRecord.findUnique({
        where: { key: selfRefundKey(userId) },
        select: { key: true },
      }),
    ]);
    const base = { windowDays, payment: null, deadline: null };
    if (used) return { ...base, eligible: false, reason: 'ALREADY_USED' };
    if (!first || !first.paidAt || first.status === 'FAILED') {
      return {
        ...base,
        eligible: false,
        reason: store ? 'STORE_PURCHASE' : 'NO_PAYMENT',
      };
    }
    const deadline = new Date(first.paidAt.getTime() + windowDays * DAY_MS);
    const view = {
      windowDays,
      payment: {
        id: first.id,
        amountCents: first.amountCents,
        currency: first.currency,
        paidAt: first.paidAt.toISOString(),
        planName: first.subscription?.plan.name ?? null,
      },
      deadline: deadline.toISOString(),
    };
    const reason: SelfRefundIneligibleReason | null =
      first.refundedCents > 0
        ? 'ALREADY_REFUNDED'
        : now > deadline
          ? 'WINDOW_PASSED'
          : null;
    return { ...view, eligible: reason === null, reason };
  }

  async requestSelfRefund(
    actor: ApiUser,
    now = new Date(),
  ): Promise<RefundOutcome> {
    const status = await this.eligibility(actor.userId, now);
    if (!status.eligible || !status.payment) {
      if (status.reason === 'STORE_PURCHASE') throw storeRefund();
      throw new ConflictException({
        code: 'REFUND_NOT_ELIGIBLE',
        message: 'This purchase is not eligible for a self-service refund',
        reason: status.reason,
        windowDays: status.windowDays,
      });
    }
    const payment = await this.loadPayment(status.payment.id);
    // Once per account: the claim is the guard (also against double taps).
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: selfRefundKey(actor.userId),
          scope: REFUND_SCOPE,
          userId: actor.userId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({
          code: 'REFUND_NOT_ELIGIBLE',
          message: 'A self-service refund was already used on this account',
          reason: 'ALREADY_USED',
        });
      throw err;
    }
    try {
      return await this.issue(payment, payment.amountCents, {
        actorId: actor.userId,
        kind: 'self_serve',
        endAccess: true,
      });
    } catch (err) {
      await this.prisma.idempotencyRecord.deleteMany({
        where: { key: selfRefundKey(actor.userId) },
      });
      throw err;
    }
  }

  // ─── Staff ───────────────────────────────────────────────────────────

  async staffRefund(
    actor: ApiUser,
    paymentId: string,
    amountCents: number | undefined,
  ): Promise<RefundOutcome & { capCents: number | null }> {
    const payment = await this.loadPayment(paymentId);
    if (payment.provider !== 'STRIPE') throw storeRefund();
    if (payment.status === 'FAILED' || !payment.paidAt)
      throw new ConflictException({
        code: 'PAYMENT_NOT_PAID',
        message: 'Only a successful payment can be refunded',
      });
    const remaining = payment.amountCents - payment.refundedCents;
    if (remaining <= 0)
      throw new ConflictException({
        code: 'ALREADY_REFUNDED',
        message: 'This payment has already been fully refunded',
      });
    const amount = amountCents ?? remaining;
    if (amount > remaining)
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_REMAINING',
        message: `At most ${remaining} can still be refunded on this payment`,
        remainingCents: remaining,
      });

    const capCents = actor.role === 'ADMIN' ? null : oneMonthCents(payment);
    if (capCents !== null && payment.refundedCents + amount > capCents) {
      throw new ForbiddenException({
        code: 'REFUND_CAP_EXCEEDED',
        message: `Support can refund at most one month (${capCents} in ${payment.currency}) of a payment — ask an admin for more`,
        capCents,
        alreadyRefundedCents: payment.refundedCents,
        requiredRole: 'ADMIN',
      });
    }

    // One refund per payment state at a time: a double submit (or two
    // staff members) can't refund the same remainder twice.
    const lockKey = `${REFUND_SCOPE}:${payment.id}:${payment.refundedCents}`;
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key: lockKey, scope: REFUND_SCOPE, userId: payment.userId },
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({
          code: 'REFUND_IN_PROGRESS',
          message:
            'A refund of this payment is already being processed — reload in a moment',
        });
      throw err;
    }
    try {
      const out = await this.issue(payment, amount, {
        actorId: actor.userId,
        kind: 'staff',
        endAccess: false,
      });
      return { ...out, capCents };
    } catch (err) {
      await this.prisma.idempotencyRecord.deleteMany({
        where: { key: lockKey },
      });
      throw err;
    }
  }

  // ─── Shared ──────────────────────────────────────────────────────────

  private async issue(
    payment: PaymentWithPlan,
    amountCents: number,
    opts: { actorId: string; kind: 'self_serve' | 'staff'; endAccess: boolean },
  ): Promise<RefundOutcome> {
    const before = {
      status: payment.status,
      refundedCents: payment.refundedCents,
    };
    let result: RefundResult;
    try {
      result = await this.billing.refundPayment({
        externalId: payment.externalId,
        amountCents,
        payment: {
          id: payment.id,
          userId: payment.userId,
          amountCents: payment.amountCents,
          refundedCents: payment.refundedCents,
          currency: payment.currency,
          paidAt: payment.paidAt,
          stripeSubscriptionId:
            payment.subscription?.stripeSubscriptionId ?? null,
        },
        idempotencyKey: `refund:${payment.id}:${payment.refundedCents}:${amountCents}`,
        metadata: {
          paymentId: payment.id,
          userId: payment.userId,
          actorId: opts.actorId,
          kind: opts.kind,
        },
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `refund of ${payment.externalId} failed at the provider: ${(err as Error).message}`,
      );
      throw new BadRequestException({
        code: 'REFUND_FAILED',
        message: `The payment provider rejected the refund: ${(err as Error).message}`,
      });
    }
    // Dev: apply the simulated charge.refunded through the webhook path.
    if (result.simulatedEvent)
      await this.webhook.processEvent(result.simulatedEvent);

    // Self-serve ends access now; a staff refund ends it only when the
    // webhook path does (a full refund of the latest invoice / a prepay).
    let accessEnded = false;
    if (payment.subscription) {
      const wasLive = LIVE.includes(payment.subscription.status);
      let sub = await this.prisma.subscription.findUnique({
        where: { id: payment.subscription.id },
      });
      if (opts.endAccess && sub && LIVE.includes(sub.status))
        sub = await this.subscriptions.endNow(sub);
      accessEnded = wasLive && !!sub && !LIVE.includes(sub.status);
    }
    const after = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, refundedCents: true },
    });
    return {
      paymentId: payment.id,
      refund: {
        id: result.refundId,
        status: result.status,
        amountCents,
        currency: payment.currency,
      },
      before,
      after,
      accessEnded,
    };
  }

  private async loadPayment(id: string): Promise<PaymentWithPlan> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        subscription: {
          select: {
            id: true,
            status: true,
            stripeSubscriptionId: true,
            plan: {
              select: {
                name: true,
                prices: {
                  where: { isActive: true },
                  select: { currency: true, period: true, amountCents: true },
                },
              },
            },
          },
        },
      },
    });
    if (!payment)
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    return payment;
  }
}

export function selfRefundKey(userId: string): string {
  return `${REFUND_SCOPE}:self:${userId}`;
}

/**
 * docs/14 §2 "SUPPORT cannot refund > 1 month of subscription": the plan's
 * monthly price in the payment's currency, else its annual price ÷ 12.
 * Null plan / no price in that currency → 0 (an admin must refund).
 */
export function oneMonthCents(
  payment: Pick<PaymentWithPlan, 'currency' | 'subscription'>,
): number {
  const prices = (payment.subscription?.plan.prices ?? []).filter(
    (p) => p.currency.toUpperCase() === payment.currency.toUpperCase(),
  );
  const monthly = prices.find((p) => p.period === 'MONTHLY');
  if (monthly) return monthly.amountCents;
  const annual = prices.find((p) => p.period === 'ANNUAL');
  return annual ? Math.round(annual.amountCents / 12) : 0;
}

function storeRefund(): BadRequestException {
  return new BadRequestException({
    code: 'STORE_REFUND',
    message:
      'App Store and Google Play purchases are refunded by Apple or Google — request it from the store',
  });
}
