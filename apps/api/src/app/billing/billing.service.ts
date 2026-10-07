import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AccessService } from './access.service.js';
import {
  BILLING_PROVIDER,
  DevBillingProvider,
  isRecurringStripeSubscriptionId,
  type BillingProvider,
  type SubscriptionSnapshot,
} from './billing.provider.js';
import type {
  ChangeSubscriptionDto,
  CheckoutSessionResponse,
  CreateCheckoutDto,
  MySubscriptionResponse,
  PortalResponse,
  SubscriptionResponse,
} from './billing.dto.js';
import {
  addBillingPeriod,
  addDays,
  toSubscriptionResponse,
} from './subscription-view.js';

function studentAppUrl(): string {
  return process.env['STUDENT_APP_URL'] ?? 'http://localhost:4202';
}

/** Statuses a user can still cancel / resume (the subscription is live). */
const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

type SubscriptionWithPlan = Subscription & { plan: { name: string } };

/**
 * Subscription lifecycle from the app's side: start a checkout, open the
 * customer portal, read state, and cancel/resume (docs/09 §5 — cancel at
 * period end, single confirm, no win-back flow). In dev mode the checkout
 * is completed locally via `completeDevCheckout` (which stands in for the
 * Stripe webhook); in Stripe mode the webhook creates the Subscription row.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
  ) {}

  async createCheckout(
    actor: ApiUser,
    dto: CreateCheckoutDto,
  ): Promise<CheckoutSessionResponse> {
    const price = await this.prisma.planPrice.findUnique({
      where: { id: dto.planPriceId },
      include: { plan: true },
    });
    if (
      !price ||
      !price.isActive ||
      price.plan.deletedAt ||
      !price.plan.isActive
    ) {
      throw new NotFoundException('Plan price not found');
    }
    const paymentMethod = dto.paymentMethod ?? 'card';
    if (
      paymentMethod !== 'card' &&
      (price.period !== 'ANNUAL' || price.currency.toUpperCase() !== 'BRL')
    ) {
      // docs/09 §4: PIX / Boleto are one-shot annual prepay (no recurring charge).
      throw new BadRequestException(
        'PIX and Boleto are only available for the BRL annual plan',
      );
    }

    const known = await this.prisma.subscription.findFirst({
      where: { userId: actor.userId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { stripeCustomerId: true },
    });

    const session = await this.billing.createCheckoutSession({
      user: { id: actor.userId, email: actor.email },
      customerId: known?.stripeCustomerId ?? null,
      plan: {
        id: price.plan.id,
        name: price.plan.name,
        trialDays: price.plan.trialDays,
        stripeProductId: price.plan.stripeProductId,
      },
      price: {
        id: price.id,
        stripePriceId: price.stripePriceId,
        currency: price.currency,
        amountCents: price.amountCents,
        period: price.period,
        maxInstallments: price.maxInstallments,
      },
      paymentMethod,
      successUrl: dto.successUrl ?? `${studentAppUrl()}/billing/success`,
      cancelUrl: dto.cancelUrl ?? `${studentAppUrl()}/subscription`,
    });

    return {
      url: session.url,
      sessionId: session.sessionId,
      mode: this.billing.mode,
    };
  }

  async createPortal(
    actor: ApiUser,
    returnUrl?: string,
  ): Promise<PortalResponse> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: actor.userId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub?.stripeCustomerId) {
      throw new NotFoundException('No web billing account to manage');
    }
    return this.billing.createPortalSession({
      user: { id: actor.userId },
      customerId: sub.stripeCustomerId,
      returnUrl: returnUrl ?? `${studentAppUrl()}/subscription`,
    });
  }

  async getMySubscriptions(actor: ApiUser): Promise<MySubscriptionResponse> {
    const [subs, grace] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId: actor.userId },
        include: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.access.pastDueGraceDays(),
    ]);
    const now = new Date();
    const items = subs.map((s) =>
      toSubscriptionResponse(s, s.plan.name, now, grace),
    );
    const activePlanIds = [
      ...new Set(items.filter((i) => i.grantsAccess).map((i) => i.planId)),
    ];
    return { subscriptions: items, activePlanIds };
  }

  /**
   * Dev-mode completion of a checkout session — the local stand-in for the
   * Stripe `checkout.session.completed` + `customer.subscription.created`
   * webhooks. The session id is HMAC-signed by the dev provider, so it
   * can't be forged for another plan/period. Idempotent per (user, plan).
   */
  async completeDevCheckout(
    actor: ApiUser,
    sessionId: string,
  ): Promise<SubscriptionResponse> {
    if (!(this.billing instanceof DevBillingProvider)) {
      throw new ForbiddenException(
        'Dev checkout completion is disabled outside dev mode',
      );
    }
    const payload = this.billing.verifySession(sessionId);
    if (!payload) throw new BadRequestException('Invalid dev session id');
    if (payload.userId !== actor.userId) {
      throw new ForbiddenException('Session belongs to a different user');
    }

    const price = await this.prisma.planPrice.findFirst({
      where: {
        id: payload.priceId,
        planId: payload.planId,
        plan: { deletedAt: null },
      },
      include: { plan: { select: { name: true } } },
    });
    if (!price) throw new NotFoundException('Plan not found');

    const now = new Date();
    const short = (id: string) => id.replace(/-/g, '').slice(0, 12);
    const stripeCustomerId = `cus_dev_${payload.userId.replace(/-/g, '').slice(0, 16)}`;
    const prepaid = payload.paymentMethod !== 'card';

    let data: Omit<
      Prisma.SubscriptionUncheckedCreateInput,
      'userId' | 'stripeSubscriptionId'
    >;
    let stripeSubscriptionId: string;
    if (prepaid) {
      // Mirrors the PIX/Boleto webhook path: a non-renewing paid period.
      stripeSubscriptionId = `cs_dev_prepaid_${short(payload.userId)}_${short(payload.planId)}`;
      data = {
        planId: payload.planId,
        source: 'STRIPE_WEB',
        stripeCustomerId,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: addBillingPeriod(now, price.period),
        cancelAtPeriodEnd: true,
        canceledAt: null,
        trialEndsAt: null,
        pastDueSince: null,
      };
    } else {
      // Deterministic per (user, plan) so re-completing is a no-op upsert.
      stripeSubscriptionId = `sub_dev_${short(payload.userId)}_${short(payload.planId)}`;
      const trialing = payload.trialDays > 0;
      data = {
        planId: payload.planId,
        source: 'STRIPE_WEB',
        stripeCustomerId,
        status: trialing ? 'TRIALING' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: trialing
          ? addDays(now, payload.trialDays)
          : addBillingPeriod(now, price.period),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: trialing ? addDays(now, payload.trialDays) : null,
        pastDueSince: null,
      };
    }

    const sub = await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId },
      create: { ...data, userId: payload.userId, stripeSubscriptionId },
      update: data,
    });
    return toSubscriptionResponse(
      sub,
      price.plan.name,
      now,
      await this.access.pastDueGraceDays(),
    );
  }

  /** Self-serve cancel: turn auto-renew off; access continues to period end. */
  async cancelMine(
    actor: ApiUser,
    dto: ChangeSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    const sub = await this.findOwnLive(actor.userId, dto.subscriptionId, false);
    assertWebManaged(sub);
    const updated = sub.cancelAtPeriodEnd
      ? sub
      : await this.setCancelAtPeriodEnd(sub, true);
    return this.view(updated, sub.plan.name);
  }

  /** Undo a pending cancellation while the paid period is still running. */
  async resumeMine(
    actor: ApiUser,
    dto: ChangeSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    const sub = await this.findOwnLive(actor.userId, dto.subscriptionId, true);
    assertWebManaged(sub);
    if (!sub.cancelAtPeriodEnd) return this.view(sub, sub.plan.name);
    if (!isRecurringStripeSubscriptionId(sub.stripeSubscriptionId)) {
      throw new BadRequestException(
        'This is a one-time (non-renewing) purchase — buy the plan again to extend it',
      );
    }
    if (sub.currentPeriodEnd.getTime() <= Date.now()) {
      throw new ConflictException('The billing period has already ended');
    }
    const updated = await this.setCancelAtPeriodEnd(sub, false);
    return this.view(updated, sub.plan.name);
  }

  /**
   * Set/clear cancel-at-period-end on the provider (renewing Stripe
   * subscriptions) and mirror it locally. Non-renewing rows (prepay, grants)
   * and the dev provider just flip the local flag.
   */
  async setCancelAtPeriodEnd(
    sub: Subscription,
    cancel: boolean,
  ): Promise<Subscription> {
    const snap = isRecurringStripeSubscriptionId(sub.stripeSubscriptionId)
      ? await this.billing.setCancelAtPeriodEnd(
          sub.stripeSubscriptionId,
          cancel,
        )
      : null;
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        cancelAtPeriodEnd: snap?.cancelAtPeriodEnd ?? cancel,
        canceledAt: cancel ? (snap?.canceledAt ?? new Date()) : null,
        ...periodFrom(snap),
      },
    });
  }

  /** End a subscription now (provider first for renewing Stripe subscriptions). */
  async endNow(sub: Subscription): Promise<Subscription> {
    if (isRecurringStripeSubscriptionId(sub.stripeSubscriptionId)) {
      await this.billing.cancelSubscriptionNow(sub.stripeSubscriptionId);
    }
    const now = new Date();
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'CANCELED',
        cancelAtPeriodEnd: false,
        canceledAt: now,
        pastDueSince: null,
        currentPeriodEnd:
          sub.currentPeriodEnd < now ? sub.currentPeriodEnd : now,
      },
    });
  }

  async view(
    sub: Subscription,
    planName: string,
  ): Promise<SubscriptionResponse> {
    return toSubscriptionResponse(
      sub,
      planName,
      new Date(),
      await this.access.pastDueGraceDays(),
    );
  }

  /**
   * The user's live subscription: by id, or else the newest one in the
   * state the operation needs (cancel → still renewing, resume → pending
   * cancellation).
   */
  private async findOwnLive(
    userId: string,
    subscriptionId: string | undefined,
    pendingCancel: boolean,
  ): Promise<SubscriptionWithPlan> {
    const sub = await this.prisma.subscription.findFirst({
      where: subscriptionId
        ? { id: subscriptionId, userId }
        : {
            userId,
            status: { in: [...LIVE_STATUSES] },
            cancelAtPeriodEnd: pendingCancel,
            currentPeriodEnd: { gt: new Date() },
          },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (!(LIVE_STATUSES as readonly string[]).includes(sub.status)) {
      throw new ConflictException('Subscription is no longer active');
    }
    return sub;
  }
}

/** App-store subscriptions can only be changed in the store (Apple/Google rules). */
export function assertWebManaged(sub: Subscription): void {
  if (sub.source === 'APPLE_IAP' || sub.source === 'GOOGLE_PLAY') {
    throw new BadRequestException(
      'This subscription is managed by the App Store / Google Play — change it there',
    );
  }
}

function periodFrom(
  snap: SubscriptionSnapshot | null,
): Prisma.SubscriptionUpdateInput {
  if (!snap) return {};
  return {
    ...(snap.currentPeriodStart
      ? { currentPeriodStart: snap.currentPeriodStart }
      : {}),
    ...(snap.currentPeriodEnd
      ? { currentPeriodEnd: snap.currentPeriodEnd }
      : {}),
  };
}
