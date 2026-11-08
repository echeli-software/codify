import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BILLING_PROVIDER,
  type BillingPeriod,
  type BillingProvider,
  type CheckoutDiscount,
} from './billing.provider.js';

type Db = Pick<Prisma.TransactionClient, 'idempotencyRecord'>;

export const WINBACK_OFFER = 'winback';
const USAGE_SCOPE = 'winback_offer';
const DAY_MS = 86_400_000;

/** docs/10 §13 day-30 offer: the discount and how long the offer stays open. */
export interface WinbackConfig {
  /** Stripe coupon id (`STRIPE_WINBACK_COUPON`). */
  couponId: string | null;
  /** Stripe promotion code id `promo_…` (`STRIPE_WINBACK_PROMOTION_CODE`); wins over the coupon. */
  promotionCodeId: string | null;
  /** Shown to the user, and what the dev provider takes off (`WINBACK_PERCENT_OFF`, default 20). */
  percentOff: number;
  /** Days after the day-30 message during which the offer can be used (`WINBACK_OFFER_DAYS`, default 14). */
  validDays: number;
}

export function winbackConfigFromEnv(
  env: Record<string, string | undefined>,
): WinbackConfig {
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return v && Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  return {
    couponId: env['STRIPE_WINBACK_COUPON']?.trim() || null,
    promotionCodeId: env['STRIPE_WINBACK_PROMOTION_CODE']?.trim() || null,
    percentOff: int(env['WINBACK_PERCENT_OFF'], 20, 1, 90),
    validDays: int(env['WINBACK_OFFER_DAYS'], 14, 1, 90),
  };
}

export type WinbackIneligibleReason =
  | 'NO_OFFER'
  | 'SUBSCRIBED'
  | 'USED'
  | 'NOT_CONFIGURED';

/** GET /billing/offers → `winback`. */
export interface WinbackOfferView {
  offer: typeof WINBACK_OFFER;
  eligible: boolean;
  reason: WinbackIneligibleReason | null;
  percentOff: number;
  /** The offer applies to annual prices only ("discount on the annual plan"). */
  appliesTo: BillingPeriod;
  /** When the offer closes (ISO), when one was sent. */
  expiresAt: string | null;
}

export function winbackUsageKey(userId: string): string {
  return `${USAGE_SCOPE}:${userId}`;
}

/**
 * Record that a user redeemed the win-back offer (once per user). Called
 * where a discounted checkout turns into a subscription: the Stripe webhook
 * (metadata `offer: winback`) and the dev checkout completion. Idempotent.
 */
export async function claimWinbackUsage(db: Db, userId: string): Promise<void> {
  await db.idempotencyRecord.createMany({
    data: [{ key: winbackUsageKey(userId), scope: USAGE_SCOPE, userId }],
    skipDuplicates: true,
  });
}

/**
 * Day-30 win-back offer (docs/10 §13): one limited-time discount on the
 * annual plan for a lapsed free user. Eligible when the reactivation sweep
 * sent the offer (REACTIVATION inbox row with `data.type = "winback"`)
 * within `validDays`, the user has no live subscription and has never
 * redeemed it. The stage itself can't be used — any activity (opening the
 * link) resets `User.reactivationStage` to 0.
 */
@Injectable()
export class WinbackOfferService {
  readonly config: WinbackConfig = winbackConfigFromEnv(process.env);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
  ) {}

  async status(userId: string, now = new Date()): Promise<WinbackOfferView> {
    const since = new Date(now.getTime() - this.config.validDays * DAY_MS);
    const [sent, live, used] = await Promise.all([
      this.prisma.notification.findFirst({
        where: {
          userId,
          channel: 'IN_APP',
          kind: 'REACTIVATION',
          createdAt: { gte: since },
          payload: { path: ['data', 'type'], equals: WINBACK_OFFER },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.subscription.findFirst({
        where: {
          userId,
          status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
          currentPeriodEnd: { gt: now },
        },
        select: { id: true },
      }),
      this.prisma.idempotencyRecord.findUnique({
        where: { key: winbackUsageKey(userId) },
        select: { key: true },
      }),
    ]);
    const configured =
      this.billing.mode === 'dev' ||
      !!this.config.couponId ||
      !!this.config.promotionCodeId;
    const reason: WinbackIneligibleReason | null = !configured
      ? 'NOT_CONFIGURED'
      : used
        ? 'USED'
        : !sent
          ? 'NO_OFFER'
          : live
            ? 'SUBSCRIBED'
            : null;
    return {
      offer: WINBACK_OFFER,
      eligible: reason === null,
      reason,
      percentOff: this.config.percentOff,
      appliesTo: 'ANNUAL',
      expiresAt: sent
        ? new Date(
            sent.createdAt.getTime() + this.config.validDays * DAY_MS,
          ).toISOString()
        : null,
    };
  }

  /** The discount for a checkout, or a 409/400 explaining why there is none. */
  async discountFor(
    userId: string,
    period: BillingPeriod,
    now = new Date(),
  ): Promise<CheckoutDiscount> {
    const status = await this.status(userId, now);
    if (!status.eligible) {
      throw new ConflictException({
        code: 'OFFER_NOT_AVAILABLE',
        message: 'This offer is not available for your account',
        reason: status.reason,
      });
    }
    if (period !== status.appliesTo) {
      throw new BadRequestException({
        code: 'OFFER_NOT_APPLICABLE',
        message: 'The win-back offer applies to the annual plan only',
      });
    }
    return {
      offer: WINBACK_OFFER,
      couponId: this.config.couponId,
      promotionCodeId: this.config.promotionCodeId,
      percentOff: this.config.percentOff,
    };
  }
}
