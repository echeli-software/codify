import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  Prisma,
  Subscription,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  REVENUECAT_PROVIDER,
  type RcEvent,
  type RevenueCatProvider,
} from './revenuecat.provider.js';
import { addDays } from './subscription-view.js';
import { recordPaid, recordRefund } from './payments.js';
import {
  DUPLICATE_RESULT,
  DuplicateWebhookEvent,
  WEBHOOK_TX_OPTIONS,
  claimWebhookEvent,
  type WebhookResult,
} from './webhook-idempotency.js';

type Tx = Prisma.TransactionClient;

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

/**
 * Turns RevenueCat entitlement events into our `Subscription` mirror
 * (/docs/17-mobile.md §RevenueCat).
 *
 * - Idempotent on the RevenueCat event id, with the idempotency record
 *   written in the same transaction as the processing (a failed delivery
 *   is retried, never mistaken for a duplicate).
 * - Identity-stable on the store's `original_transaction_id` (survives
 *   renewals) so renewals update the same row.
 * - Plan resolution: `PlanPrice.storeProductId === product_id`, then the
 *   plan's `revenueCatEntitlementId`.
 * - Ordering: an event describing an older store period (expiration before
 *   the row's current period end) is skipped, so a late CANCELLATION or
 *   EXPIRATION can't undo a renewal.
 * - Unknown `app_user_id` → acked with handled:false (no FK error loop).
 */
@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REVENUECAT_PROVIDER) private readonly rc: RevenueCatProvider,
  ) {}

  async handle(
    rawBody: string,
    authHeader: string | undefined,
  ): Promise<WebhookResult> {
    const event = this.rc.constructEvent(rawBody, authHeader);
    if (!event)
      throw new BadRequestException(
        'Invalid or unauthenticated RevenueCat webhook',
      );

    const key = `revenuecat:${event.id}`;
    try {
      const handled = await this.prisma.$transaction(async (tx) => {
        await claimWebhookEvent(tx, key, 'revenuecat_webhook');
        return this.process(tx, event);
      }, WEBHOOK_TX_OPTIONS);
      return { received: true, duplicate: false, handled };
    } catch (err) {
      if (err instanceof DuplicateWebhookEvent) return DUPLICATE_RESULT;
      throw err;
    }
  }

  private async process(tx: Tx, event: RcEvent): Promise<boolean> {
    const subscriptionChanged = await this.applySubscription(tx, event);
    const paymentLogged = await this.logPayment(tx, event);
    return subscriptionChanged || paymentLogged;
  }

  /**
   * Billing history (docs/09 §6, docs/05): store purchases and renewals
   * (not PRODUCT_CHANGE, which charges on the following RENEWAL) become
   * PAID Payments keyed on the store `transaction_id` of that
   * charge; a CANCELLATION with cancel_reason CUSTOMER_SUPPORT is the
   * store's refund and marks that transaction REFUNDED. Web (Stripe)
   * purchases relayed by RevenueCat are skipped — the Stripe webhook logs
   * them. Free trials (price 0) are not payments.
   */
  private async logPayment(tx: Tx, event: RcEvent): Promise<boolean> {
    const provider =
      event.store === 'APP_STORE'
        ? ('APPLE' as const)
        : event.store === 'PLAY_STORE'
          ? ('GOOGLE' as const)
          : null;
    const purchase = PURCHASE_EVENTS.has(event.type);
    const refund =
      event.type === 'CANCELLATION' &&
      event.cancel_reason === 'CUSTOMER_SUPPORT';
    if (!provider || (!purchase && !refund)) return false;
    const externalId = event.transaction_id ?? null;
    const price = event.price_in_purchased_currency ?? event.price ?? null;
    if (!externalId || price === null || !Number.isFinite(price)) return false;
    const amountCents = Math.round(Math.abs(price) * 100);
    if (amountCents === 0) return false;

    const sub = await tx.subscription.findUnique({
      where: { storeTransactionId: this.txId(event) ?? externalId },
      select: { id: true, userId: true },
    });
    const userId =
      sub?.userId ??
      (
        await tx.user.findUnique({
          where: { id: event.app_user_id },
          select: { id: true },
        })
      )?.id;
    if (!userId) return false;
    const facts = {
      userId,
      subscriptionId: sub?.id ?? null,
      provider,
      externalId,
      amountCents,
      currency:
        event.price_in_purchased_currency != null && event.currency
          ? event.currency
          : 'USD',
      method: 'store',
      receiptUrl: null,
      paidAt: msToDate(event.purchased_at_ms) ?? eventAt(event),
    };
    if (purchase) await recordPaid(tx, facts);
    else await recordRefund(tx, { ...facts, refundedCents: amountCents });
    return true;
  }

  private async applySubscription(tx: Tx, event: RcEvent): Promise<boolean> {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        return this.upsertActive(tx, event);
      case 'CANCELLATION':
        // Auto-renew turned off (or refund pending): access continues until
        // the current period ends.
        return this.update(tx, event, () => ({
          cancelAtPeriodEnd: true,
          canceledAt: eventAt(event),
        }));
      case 'EXPIRATION':
        // Access has actually ended.
        return this.update(tx, event, (existing) => ({
          status: 'CANCELED',
          cancelAtPeriodEnd: false,
          pastDueSince: null,
          canceledAt: existing.canceledAt ?? eventAt(event),
          currentPeriodEnd: msToDate(event.expiration_at_ms) ?? eventAt(event),
        }));
      case 'BILLING_ISSUE':
        return this.update(tx, event, (existing) => ({
          status: 'PAST_DUE',
          // Keep the start of an ongoing past-due episode; a new one starts now.
          pastDueSince:
            existing.status === 'PAST_DUE'
              ? existing.pastDueSince
              : eventAt(event),
        }));
      default:
        this.logger.debug(
          `Ignoring unhandled RevenueCat event type ${event.type}`,
        );
        return false;
    }
  }

  /** Resolve the local plan: store product id first, then entitlement. */
  private async resolvePlanId(tx: Tx, event: RcEvent): Promise<string | null> {
    if (event.product_id) {
      const price = await tx.planPrice.findFirst({
        where: { storeProductId: event.product_id, plan: { deletedAt: null } },
        select: { planId: true },
      });
      if (price) return price.planId;
    }
    const entitlements = event.entitlement_ids ?? [];
    if (entitlements.length === 0) return null;
    // Inactive plans still resolve: the store sold it, the user paid.
    const plan = await tx.plan.findFirst({
      where: { revenueCatEntitlementId: { in: entitlements }, deletedAt: null },
      select: { id: true },
    });
    return plan?.id ?? null;
  }

  /** The stable per-subscription identity across renewals. */
  private txId(event: RcEvent): string | null {
    return event.original_transaction_id ?? event.transaction_id ?? null;
  }

  /** Does this event describe an older store period than the row already holds? */
  private isStale(existing: Subscription, event: RcEvent): boolean {
    const exp = msToDate(event.expiration_at_ms);
    return !!exp && exp.getTime() < existing.currentPeriodEnd.getTime();
  }

  private async upsertActive(tx: Tx, event: RcEvent): Promise<boolean> {
    const transactionId = this.txId(event);
    const userId = event.app_user_id;
    if (!transactionId || !userId) {
      this.logger.warn(
        `RevenueCat ${event.type} ${event.id} missing transaction id / app_user_id — skipping`,
      );
      return false;
    }

    const existing = await tx.subscription.findUnique({
      where: { storeTransactionId: transactionId },
    });
    if (existing && this.isStale(existing, event)) {
      this.logger.log(`Skipping stale RevenueCat ${event.type} ${event.id}`);
      return false;
    }

    const planId = await this.resolvePlanId(tx, event);
    if (!planId && !existing) {
      this.logger.warn(
        `RevenueCat ${event.type} ${event.id}: no plan matches product ${event.product_id ?? '-'} / entitlements ${JSON.stringify(event.entitlement_ids)} — skipping`,
      );
      return false;
    }

    const now = eventAt(event);
    const periodStart =
      msToDate(event.purchased_at_ms) ?? existing?.currentPeriodStart ?? now;
    const periodEnd =
      msToDate(event.expiration_at_ms) ??
      existing?.currentPeriodEnd ??
      addDays(now, 30);
    const isTrial = event.period_type === 'TRIAL';
    const status: SubscriptionStatus = isTrial ? 'TRIALING' : 'ACTIVE';

    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          planId: planId ?? existing.planId,
          status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pastDueSince: null,
          trialEndsAt: isTrial ? periodEnd : existing.trialEndsAt,
          storeProductId: event.product_id ?? existing.storeProductId,
          revenueCatUserId: userId,
        },
      });
      return true;
    }

    // app_user_id must be one of our User ids (the app logs in to RevenueCat
    // with it). Anonymous / foreign ids are acked, not retried forever.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      this.logger.warn(
        `RevenueCat ${event.type} ${event.id}: app_user_id "${userId}" is not a known user — acked, not applied`,
      );
      return false;
    }

    await tx.subscription.create({
      data: {
        userId,
        planId: planId as string,
        source: sourceFromStore(event.store),
        revenueCatUserId: userId,
        storeTransactionId: transactionId,
        storeProductId: event.product_id ?? null,
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEndsAt: isTrial ? periodEnd : null,
      },
    });
    return true;
  }

  /** Apply a patch to the mirrored row, unless the event is stale. */
  private async update(
    tx: Tx,
    event: RcEvent,
    patch: (existing: Subscription) => Prisma.SubscriptionUpdateInput,
  ): Promise<boolean> {
    const transactionId = this.txId(event);
    if (!transactionId) return false;
    const existing = await tx.subscription.findUnique({
      where: { storeTransactionId: transactionId },
    });
    if (!existing) return false;
    if (this.isStale(existing, event)) {
      this.logger.log(`Skipping stale RevenueCat ${event.type} ${event.id}`);
      return false;
    }
    await tx.subscription.update({
      where: { id: existing.id },
      data: patch(existing),
    });
    return true;
  }
}

/** Events that charged the customer (one store transaction each). */
const PURCHASE_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
]);

/** RevenueCat timestamps are unix milliseconds; null/undefined → null. */
function msToDate(ms: number | null | undefined): Date | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventAt(event: RcEvent): Date {
  return msToDate(event.event_timestamp_ms) ?? new Date();
}
