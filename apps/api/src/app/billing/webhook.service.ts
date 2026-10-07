import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BILLING_PROVIDER,
  idOf,
  snapshotFromStripeSubscription,
  type BillingProvider,
  type StripeWebhookEvent,
  type SubscriptionSnapshot,
} from './billing.provider.js';
import { addBillingPeriod } from './subscription-view.js';
import {
  DUPLICATE_RESULT,
  DuplicateWebhookEvent,
  WEBHOOK_TX_OPTIONS,
  claimWebhookEvent,
  type WebhookResult,
} from './webhook-idempotency.js';

type Tx = Prisma.TransactionClient;

/** Stripe status string → our enum. */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
};

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);
const CHECKOUT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

/** Subscription state fetched before the transaction (network stays outside it). */
interface Prefetched {
  snapshot: SubscriptionSnapshot | null;
}

/**
 * Processes Stripe webhook events into our `Subscription` mirror
 * (/docs/09-billing.md §5–§6).
 *
 * Idempotency: the `IdempotencyRecord` for `event.id` is written in the SAME
 * transaction that applies the event, so a failed delivery is retried by
 * Stripe instead of being dropped as a duplicate.
 *
 * Ordering: in Stripe mode every subscription-related event re-reads the
 * subscription from the API and applies that (current) state, so an old
 * event delivered late can't roll state back. Without an API (dev), the
 * payload is applied behind a staleness guard (see `isStale`).
 *
 * Processing is inline; /docs/09 §6's BullMQ hand-off can wrap `handle`.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
  ) {}

  async handleStripe(
    rawBody: Buffer | string | undefined,
    parsedBody: unknown,
    signature: string | undefined,
  ): Promise<WebhookResult> {
    let payload: Buffer | string;
    if (rawBody != null && rawBody.length > 0) {
      payload = rawBody;
    } else if (this.billing.mode === 'stripe') {
      // Signature verification is over the exact bytes Stripe sent.
      throw new BadRequestException(
        'Raw request body unavailable; cannot verify signature',
      );
    } else {
      payload = JSON.stringify(parsedBody ?? {});
    }

    const event = this.billing.constructWebhookEvent(payload, signature);
    if (!event) throw new BadRequestException('Invalid webhook payload');

    const key = `stripe:${event.id}`;
    // Cheap fast path for replays (the in-transaction claim is the real guard).
    const seen = await this.prisma.idempotencyRecord.findUnique({
      where: { key },
    });
    if (seen) return DUPLICATE_RESULT;

    const prefetched = await this.prefetch(event);
    try {
      const handled = await this.prisma.$transaction(async (tx) => {
        await claimWebhookEvent(tx, key, 'stripe_webhook');
        return this.process(tx, event, prefetched);
      }, WEBHOOK_TX_OPTIONS);
      return { received: true, duplicate: false, handled };
    } catch (err) {
      if (err instanceof DuplicateWebhookEvent) return DUPLICATE_RESULT;
      throw err;
    }
  }

  /** Fetch the current subscription for subscription-related events (Stripe mode). */
  private async prefetch(event: StripeWebhookEvent): Promise<Prefetched> {
    const id = subscriptionIdOf(event);
    if (!id) return { snapshot: null };
    return { snapshot: await this.billing.retrieveSubscription(id) };
  }

  private async process(
    tx: Tx,
    event: StripeWebhookEvent,
    pre: Prefetched,
  ): Promise<boolean> {
    const obj = event.data.object;
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const snap = pre.snapshot ?? snapshotFromStripeSubscription(obj);
      if (!snap) return false;
      if (event.type === 'customer.subscription.deleted')
        snap.status = 'canceled';
      return this.applySnapshot(tx, snap, event, {
        fromApi: pre.snapshot !== null,
      });
    }

    if (
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_failed'
    ) {
      if (pre.snapshot) {
        return this.applySnapshot(tx, pre.snapshot, event, { fromApi: true });
      }
      const subId = subscriptionIdOf(event);
      if (!subId) return false;
      return this.setStatusFromInvoice(
        tx,
        subId,
        event.type === 'invoice.paid' ? 'ACTIVE' : 'PAST_DUE',
        event,
      );
    }

    if (CHECKOUT_EVENTS.has(event.type))
      return this.handleCheckout(tx, event, pre);

    this.logger.debug(`Ignoring unhandled event type ${event.type}`);
    return false;
  }

  private async handleCheckout(
    tx: Tx,
    event: StripeWebhookEvent,
    pre: Prefetched,
  ): Promise<boolean> {
    const session = event.data.object;
    const mode = session['mode'];
    const metadata = stringRecord(session['metadata']);

    if (event.type === 'checkout.session.async_payment_failed') {
      this.logger.warn(
        `Checkout ${String(session['id'])} async payment failed (user ${metadata['userId'] ?? '?'}) — no access granted`,
      );
      return false;
    }

    if (mode === 'subscription') {
      // Card path: the subscription itself is the source of truth.
      if (!pre.snapshot) return false;
      return this.applySnapshot(tx, pre.snapshot, event, {
        fromApi: true,
        fallbackMetadata: metadata,
        fallbackCustomerId: idOf(session['customer']),
      });
    }

    if (mode === 'payment') {
      const paid =
        event.type === 'checkout.session.async_payment_succeeded' ||
        session['payment_status'] === 'paid' ||
        session['payment_status'] === 'no_payment_required';
      // PIX / Boleto complete the session before the money arrives —
      // wait for async_payment_succeeded.
      if (!paid) return false;
      return this.grantPrepaid(tx, session, metadata, event);
    }
    return false;
  }

  /**
   * One-shot PIX / Boleto prepay → a non-renewing Subscription for the
   * paid period (1 year for the annual price). Keyed on the Checkout
   * Session id so replays and completed+async_succeeded pairs are no-ops.
   */
  private async grantPrepaid(
    tx: Tx,
    session: Record<string, unknown>,
    metadata: Record<string, string>,
    event: StripeWebhookEvent,
  ): Promise<boolean> {
    const sessionId = typeof session['id'] === 'string' ? session['id'] : null;
    const { userId, planId, priceId } = metadata;
    if (!sessionId || !userId || !planId || !priceId) {
      this.logger.warn(
        `Checkout ${sessionId ?? '?'} missing userId/planId/priceId metadata`,
      );
      return false;
    }
    const [user, price] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
      tx.planPrice.findUnique({
        where: { id: priceId },
        select: {
          planId: true,
          period: true,
          plan: { select: { deletedAt: true } },
        },
      }),
    ]);
    if (!user || !price || price.planId !== planId || price.plan.deletedAt) {
      this.logger.warn(
        `Checkout ${sessionId}: unknown user/plan/price (${userId}/${planId}/${priceId}) — not granting`,
      );
      return false;
    }
    const start = eventTime(event);
    await tx.subscription.upsert({
      where: { stripeSubscriptionId: sessionId },
      create: {
        userId,
        planId,
        source: 'STRIPE_WEB',
        stripeSubscriptionId: sessionId,
        stripeCustomerId: idOf(session['customer']),
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: addBillingPeriod(start, price.period),
        // Prepaid: nothing renews, access ends with the paid period.
        cancelAtPeriodEnd: true,
      },
      update: {},
    });
    return true;
  }

  private async applySnapshot(
    tx: Tx,
    snap: SubscriptionSnapshot,
    event: StripeWebhookEvent,
    opts: {
      fromApi: boolean;
      fallbackMetadata?: Record<string, string>;
      fallbackCustomerId?: string | null;
    },
  ): Promise<boolean> {
    const existing = await tx.subscription.findUnique({
      where: { stripeSubscriptionId: snap.id },
    });
    if (!opts.fromApi && existing && this.isStale(existing, snap, event)) {
      this.logger.log(
        `Skipping stale ${event.type} ${event.id} for ${snap.id}`,
      );
      return false;
    }

    const at = eventTime(event);
    const mapped = STATUS_MAP[snap.status];
    if (!mapped && !existing) {
      this.logger.warn(
        `Unknown Stripe status "${snap.status}" for new ${snap.id} — skipping`,
      );
      return false;
    }
    const status: SubscriptionStatus =
      mapped ?? (existing as Subscription).status;

    const metadata = { ...opts.fallbackMetadata, ...snap.metadata };
    const planId = await this.resolvePlanId(tx, snap, metadata, existing);
    if (!planId) {
      this.logger.warn(
        `No plan resolvable for ${snap.id} (${event.type}) — skipping`,
      );
      return false;
    }

    const periodStart =
      snap.currentPeriodStart ?? existing?.currentPeriodStart ?? at;
    let periodEnd =
      snap.currentPeriodEnd ??
      existing?.currentPeriodEnd ??
      addBillingPeriod(at, 'MONTHLY');
    let canceledAt = snap.canceledAt ?? existing?.canceledAt ?? null;
    if (status === 'CANCELED') {
      // A canceled Stripe subscription has ended: close the window.
      const ended = snap.endedAt ?? snap.canceledAt ?? at;
      if (ended < periodEnd) periodEnd = ended;
      canceledAt = canceledAt ?? ended;
    }
    const pastDueSince =
      status === 'PAST_DUE'
        ? (existing?.pastDueSince ??
          (existing?.status === 'PAST_DUE' ? null : at))
        : null;
    const common = {
      planId,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd:
        snap.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
      canceledAt,
      trialEndsAt: snap.trialEnd ?? existing?.trialEndsAt ?? null,
      pastDueSince,
    };

    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          ...common,
          stripeCustomerId:
            snap.customerId ??
            opts.fallbackCustomerId ??
            existing.stripeCustomerId,
        },
      });
      return true;
    }

    const userId = metadata['userId'];
    const user = userId
      ? await tx.user.findUnique({
          where: { id: userId },
          select: { id: true },
        })
      : null;
    if (!user) {
      this.logger.warn(
        `${event.type} for ${snap.id}: unknown userId "${userId ?? ''}" — skipping`,
      );
      return false;
    }
    await tx.subscription.create({
      data: {
        ...common,
        userId: user.id,
        source: 'STRIPE_WEB',
        stripeSubscriptionId: snap.id,
        stripeCustomerId: snap.customerId ?? opts.fallbackCustomerId ?? null,
      },
    });
    return true;
  }

  /**
   * Plan from the subscription's Stripe Price (follows portal upgrades /
   * downgrades), else the metadata set at checkout, else the current row.
   */
  private async resolvePlanId(
    tx: Tx,
    snap: SubscriptionSnapshot,
    metadata: Record<string, string>,
    existing: Subscription | null,
  ): Promise<string | null> {
    if (snap.priceIds.length) {
      const price = await tx.planPrice.findFirst({
        where: { stripePriceId: { in: snap.priceIds } },
        select: { planId: true },
      });
      if (price) return price.planId;
    }
    const candidate = metadata['planId'];
    if (candidate && candidate !== existing?.planId) {
      const plan = await tx.plan.findUnique({
        where: { id: candidate },
        select: { id: true },
      });
      if (plan) return plan.id;
    }
    return existing?.planId ?? null;
  }

  /**
   * Payload-path ordering guard (no API to re-read from). Canceled is
   * terminal on Stripe's side (a resubscription is a new subscription id),
   * so an end-of-subscription event always applies and nothing may revive
   * a canceled row. Otherwise an event is stale when it describes an older
   * billing period or was created before our row last changed — the latter
   * uses `updatedAt` as the high-water mark; exact ordering needs a
   * `lastStripeEventAt` column.
   */
  private isStale(
    existing: Subscription,
    snap: SubscriptionSnapshot,
    event: StripeWebhookEvent,
  ): boolean {
    if (snap.status === 'canceled') return false;
    if (existing.status === 'CANCELED') return true;
    if (
      snap.currentPeriodEnd &&
      snap.currentPeriodEnd < existing.currentPeriodEnd
    )
      return true;
    return (
      typeof event.created === 'number' &&
      event.created * 1000 < existing.updatedAt.getTime()
    );
  }

  /** Dev/payload fallback for invoice events: flip status on the mirrored row. */
  private async setStatusFromInvoice(
    tx: Tx,
    stripeSubscriptionId: string,
    status: 'ACTIVE' | 'PAST_DUE',
    event: StripeWebhookEvent,
  ): Promise<boolean> {
    const existing = await tx.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (!existing || existing.status === 'CANCELED') return false;
    if (
      typeof event.created === 'number' &&
      event.created * 1000 < existing.updatedAt.getTime()
    ) {
      this.logger.log(`Skipping stale ${event.type} ${event.id}`);
      return false;
    }
    await tx.subscription.update({
      where: { id: existing.id },
      data: {
        status,
        pastDueSince:
          status === 'PAST_DUE'
            ? (existing.pastDueSince ?? eventTime(event))
            : null,
      },
    });
    return true;
  }
}

/** The Stripe subscription an event is about, if any. */
function subscriptionIdOf(event: StripeWebhookEvent): string | null {
  const o = event.data.object;
  if (SUBSCRIPTION_EVENTS.has(event.type))
    return typeof o['id'] === 'string' ? o['id'] : null;
  if (event.type.startsWith('invoice.')) {
    const parent = o['parent'] as
      | { subscription_details?: { subscription?: unknown } | null }
      | null
      | undefined;
    return (
      idOf(o['subscription']) ??
      idOf(parent?.subscription_details?.subscription)
    );
  }
  if (CHECKOUT_EVENTS.has(event.type) && o['mode'] === 'subscription') {
    return idOf(o['subscription']);
  }
  return null;
}

function eventTime(event: StripeWebhookEvent): Date {
  return typeof event.created === 'number'
    ? new Date(event.created * 1000)
    : new Date();
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}
