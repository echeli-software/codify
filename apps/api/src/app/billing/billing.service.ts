import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Subscription } from '@prisma/client';
import { subscriptionGrantsAccess } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  BILLING_PROVIDER,
  decodeDevSession,
  type BillingProvider,
} from './billing.provider.js';
import type {
  CheckoutSessionResponse,
  CreateCheckoutDto,
  MySubscriptionResponse,
  PortalResponse,
  SubscriptionResponse,
} from './billing.dto.js';

const DAY_MS = 86_400_000;

function studentAppUrl(): string {
  return process.env['STUDENT_APP_URL'] ?? 'http://localhost:4202';
}

/**
 * Subscription lifecycle from the app's side: start a checkout, open the
 * customer portal, and read the user's current subscription state. In dev
 * mode the checkout is completed locally via `completeDevCheckout` (which
 * stands in for the Stripe webhook); in Stripe mode the webhook handler
 * (Phase 6e) creates the Subscription row instead.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
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
    if (!price || price.plan.deletedAt || !price.plan.isActive) {
      throw new NotFoundException('Plan price not found');
    }

    const successUrl = dto.successUrl ?? `${studentAppUrl()}/billing/success`;
    const cancelUrl = dto.cancelUrl ?? `${studentAppUrl()}/subscription`;

    const session = await this.billing.createCheckoutSession({
      user: { id: actor.userId, email: actor.email },
      plan: {
        id: price.plan.id,
        name: price.plan.name,
        trialDays: price.plan.trialDays,
      },
      price: {
        id: price.id,
        stripePriceId: price.stripePriceId,
        currency: price.currency,
        amountCents: price.amountCents,
        period: price.period,
        maxInstallments: price.maxInstallments,
      },
      paymentMethod: dto.paymentMethod ?? 'card',
      successUrl,
      cancelUrl,
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
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException('No subscription to manage');
    if (!sub.stripeCustomerId) {
      throw new BadRequestException(
        'This subscription is managed by the app store, not the billing portal',
      );
    }
    return this.billing.createPortalSession({
      user: { id: actor.userId },
      customerId: sub.stripeCustomerId,
      returnUrl: returnUrl ?? `${studentAppUrl()}/subscription`,
    });
  }

  async getMySubscriptions(actor: ApiUser): Promise<MySubscriptionResponse> {
    const subs = await this.prisma.subscription.findMany({
      where: { userId: actor.userId },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    const items = subs.map((s) => toSubscriptionResponse(s, s.plan.name, now));
    const activePlanIds = [
      ...new Set(items.filter((i) => i.grantsAccess).map((i) => i.planId)),
    ];
    return { subscriptions: items, activePlanIds };
  }

  /**
   * Dev-mode completion of a checkout session — the local stand-in for the
   * Stripe `checkout.session.completed` + `customer.subscription.created`
   * webhooks. Idempotent on the synthesized stripeSubscriptionId.
   */
  async completeDevCheckout(
    actor: ApiUser,
    sessionId: string,
  ): Promise<SubscriptionResponse> {
    if (this.billing.mode !== 'dev') {
      throw new ForbiddenException(
        'Dev checkout completion is disabled outside dev mode',
      );
    }
    const payload = decodeDevSession(sessionId);
    if (!payload) throw new BadRequestException('Invalid dev session id');
    if (payload.userId !== actor.userId) {
      throw new ForbiddenException('Session belongs to a different user');
    }

    const plan = await this.prisma.plan.findFirst({
      where: { id: payload.planId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const now = new Date();
    const periodMs = payload.period === 'ANNUAL' ? 365 * DAY_MS : 30 * DAY_MS;
    const trialing = payload.trialDays > 0;
    const trialEndsAt = trialing
      ? new Date(now.getTime() + payload.trialDays * DAY_MS)
      : null;
    // Deterministic per (user, plan) so re-completing the same checkout is a no-op upsert.
    const stripeSubscriptionId = `sub_dev_${payload.userId.replace(/-/g, '').slice(0, 12)}_${payload.planId
      .replace(/-/g, '')
      .slice(0, 12)}`;
    const stripeCustomerId = `cus_dev_${payload.userId.replace(/-/g, '').slice(0, 16)}`;

    const sub = await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId },
      create: {
        userId: payload.userId,
        planId: payload.planId,
        source: 'STRIPE_WEB',
        stripeSubscriptionId,
        stripeCustomerId,
        status: trialing ? 'TRIALING' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodMs),
        trialEndsAt,
      },
      update: {
        planId: payload.planId,
        status: trialing ? 'TRIALING' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodMs),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt,
      },
    });
    return toSubscriptionResponse(sub, plan.name, now);
  }
}

function toSubscriptionResponse(
  s: Subscription,
  planName: string,
  now: Date,
): SubscriptionResponse {
  return {
    id: s.id,
    planId: s.planId,
    planName,
    status: s.status,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    grantsAccess: subscriptionGrantsAccess(
      {
        planId: s.planId,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
      },
      now,
    ),
  };
}
