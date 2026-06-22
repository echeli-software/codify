import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type SubscriptionSource, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { REVENUECAT_PROVIDER, type RcEvent, type RevenueCatProvider } from './revenuecat.provider.js';

/** RevenueCat store → our SubscriptionSource. */
function sourceFromStore(store: string | undefined): SubscriptionSource {
  switch (store) {
    case 'APP_STORE':
      return 'APPLE_IAP';
    case 'PLAY_STORE':
      return 'GOOGLE_PLAY';
    case 'STRIPE':
      return 'STRIPE_WEB';
    default:
      return 'APPLE_IAP';
  }
}

interface SyncResult {
  received: boolean;
  duplicate: boolean;
  handled: boolean;
}

/**
 * Turns RevenueCat entitlement events into our `Subscription` mirror.
 * Idempotent on the RevenueCat event id, and identity-stable on the store's
 * `original_transaction_id` (which survives renewals) so renewals update the
 * same row rather than creating duplicates. See /docs/11-mobile.md.
 *
 * Access is resolved purely from `Subscription` rows (AccessService is
 * source-agnostic), so a synced store purchase grants access with no extra
 * wiring — exactly like a Stripe-web subscription.
 */
@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REVENUECAT_PROVIDER) private readonly rc: RevenueCatProvider,
  ) {}

  async handle(rawBody: string, authHeader: string | undefined): Promise<SyncResult> {
    const event = this.rc.constructEvent(rawBody, authHeader);
    if (!event) throw new BadRequestException('Invalid or unauthenticated RevenueCat webhook');

    // Idempotency: insert-first so concurrent duplicate deliveries collide on
    // the PK rather than double-processing.
    const key = `revenuecat:${event.id}`;
    try {
      await this.prisma.idempotencyRecord.create({ data: { key, scope: 'revenuecat_webhook' } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, duplicate: true, handled: false };
      }
      throw err;
    }

    const handled = await this.process(event);
    return { received: true, duplicate: false, handled };
  }

  private async process(event: RcEvent): Promise<boolean> {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        return this.upsertActive(event);
      case 'CANCELLATION':
        // Auto-renew turned off (or refund pending): access continues until
        // the current period ends.
        return this.markCancelAtPeriodEnd(event);
      case 'EXPIRATION':
        // Access has actually ended.
        return this.expire(event);
      case 'BILLING_ISSUE':
        return this.setStatus(event, 'PAST_DUE');
      default:
        this.logger.debug(`Ignoring unhandled RevenueCat event type ${event.type}`);
        return false;
    }
  }

  /** Resolve the local plan from the event's entitlement ids. */
  private async resolvePlanId(event: RcEvent): Promise<string | null> {
    const entitlements = event.entitlement_ids ?? [];
    if (entitlements.length === 0) return null;
    const plan = await this.prisma.plan.findFirst({
      where: { revenueCatEntitlementId: { in: entitlements }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return plan?.id ?? null;
  }

  /** The stable per-subscription identity across renewals. */
  private txId(event: RcEvent): string | null {
    return event.original_transaction_id ?? event.transaction_id ?? null;
  }

  private async upsertActive(event: RcEvent): Promise<boolean> {
    const transactionId = this.txId(event);
    const userId = event.app_user_id;
    if (!transactionId || !userId) {
      this.logger.warn(`RevenueCat ${event.type} ${event.id} missing transaction id / app_user_id — skipping`);
      return false;
    }

    const planId = await this.resolvePlanId(event);
    const existing = await this.prisma.subscription.findUnique({ where: { storeTransactionId: transactionId } });

    if (!planId && !existing) {
      this.logger.warn(`RevenueCat ${event.type} ${event.id}: no plan matches entitlements ${JSON.stringify(event.entitlement_ids)} — skipping`);
      return false;
    }

    const periodStart = msToDate(event.purchased_at_ms) ?? existing?.currentPeriodStart ?? new Date();
    const periodEnd = msToDate(event.expiration_at_ms) ?? existing?.currentPeriodEnd ?? addDays(new Date(), 30);
    const isTrial = event.period_type === 'TRIAL';
    const status: SubscriptionStatus = isTrial ? 'TRIALING' : 'ACTIVE';

    if (existing) {
      await this.prisma.subscription.update({
        where: { storeTransactionId: transactionId },
        data: {
          planId: planId ?? existing.planId,
          status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          trialEndsAt: isTrial ? periodEnd : existing.trialEndsAt,
          storeProductId: event.product_id ?? existing.storeProductId,
          revenueCatUserId: userId,
        },
      });
      return true;
    }

    const data: Prisma.SubscriptionUncheckedCreateInput = {
      userId,
      planId: planId!,
      source: sourceFromStore(event.store),
      revenueCatUserId: userId,
      storeTransactionId: transactionId,
      storeProductId: event.product_id ?? null,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: isTrial ? periodEnd : null,
    };
    await this.prisma.subscription.create({ data });
    return true;
  }

  private async markCancelAtPeriodEnd(event: RcEvent): Promise<boolean> {
    const transactionId = this.txId(event);
    if (!transactionId) return false;
    const existing = await this.prisma.subscription.findUnique({ where: { storeTransactionId: transactionId } });
    if (!existing) return false;
    await this.prisma.subscription.update({
      where: { storeTransactionId: transactionId },
      data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
    });
    return true;
  }

  private async expire(event: RcEvent): Promise<boolean> {
    const transactionId = this.txId(event);
    if (!transactionId) return false;
    const existing = await this.prisma.subscription.findUnique({ where: { storeTransactionId: transactionId } });
    if (!existing) return false;
    const now = new Date();
    const periodEnd = msToDate(event.expiration_at_ms) ?? now;
    await this.prisma.subscription.update({
      where: { storeTransactionId: transactionId },
      data: { status: 'CANCELED', canceledAt: existing.canceledAt ?? now, currentPeriodEnd: periodEnd },
    });
    return true;
  }

  private async setStatus(event: RcEvent, status: SubscriptionStatus): Promise<boolean> {
    const transactionId = this.txId(event);
    if (!transactionId) return false;
    const existing = await this.prisma.subscription.findUnique({ where: { storeTransactionId: transactionId } });
    if (!existing) return false;
    await this.prisma.subscription.update({ where: { storeTransactionId: transactionId }, data: { status } });
    return true;
  }
}

/** RevenueCat timestamps are unix milliseconds; null/undefined → null. */
function msToDate(ms: number | null | undefined): Date | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
