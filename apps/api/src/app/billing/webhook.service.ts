import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import { reportException } from '../common/sentry.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import {
  GamificationService,
  coinKey,
} from '../gamification/gamification.service.js';
import {
  PushService,
  type UserPushContent,
} from '../notifications/push.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BILLING_PROVIDER,
  idOf,
  isRecurringStripeSubscriptionId,
  snapshotFromStripeSubscription,
  toDate,
  type BillingProvider,
  type ChargeContext,
  type StripeWebhookEvent,
  type SubscriptionSnapshot,
} from './billing.provider.js';
import { addBillingPeriod } from './subscription-view.js';
import {
  DUPLICATE_RESULT,
  DuplicateWebhookEvent,
  QUEUED_RESULT,
  WEBHOOK_TX_OPTIONS,
  claimWebhookEvent,
  type WebhookResult,
} from './webhook-idempotency.js';
import {
  BILLING_WEBHOOK_ENQUEUER,
  type WebhookEnqueuer,
} from './webhook-queue.js';
import { paymentFailedCopy } from './billing-push-copy.js';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Subscription state fetched before the transaction (network stays outside it). */
interface Prefetched {
  snapshot: SubscriptionSnapshot | null;
  /** charge.refunded: what the charge paid for. */
  charge?: ChargeContext | null;
}

/** Side effects that must run only after the event's transaction commits. */
type AfterCommit =
  | { kind: 'push'; userId: string; content: UserPushContent; what: string }
  | { kind: 'cancel_at_provider'; stripeSubscriptionId: string };

/** GamificationService idempotency key of a subscription's first-payment bonus. */
export function firstPaymentBonusKey(subscriptionRowId: string): string {
  return `billing_bonus:${subscriptionRowId}`;
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
 * Delivery (/docs/09 §6 steps 3–5): `handleStripe` verifies the signature
 * and drops fast duplicates inside the HTTP request, then enqueues the
 * verified event on the `billing-webhooks` BullMQ queue and returns 200.
 * `WebhookProcessor` runs `processEvent` (claim + apply in one transaction)
 * with 5 attempts and exponential backoff; the final failure goes to
 * Sentry. Without Redis in development the event is processed inline; in
 * production an unreachable queue answers 503 so Stripe retries.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
    @Inject(BILLING_WEBHOOK_ENQUEUER)
    private readonly enqueuer: WebhookEnqueuer,
    private readonly gamification: GamificationService,
    private readonly config: GamificationConfigService,
    private readonly push: PushService,
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

    if (await this.enqueuer.enqueue(event)) return QUEUED_RESULT;
    if (process.env['NODE_ENV'] === 'production') {
      this.logger.error(
        `Billing webhook queue unreachable (REDIS_URL) — answering 503 so Stripe retries ${event.id}`,
      );
      throw new ServiceUnavailableException(
        'Webhook queue unavailable; retry later',
      );
    }
    this.logger.warn(
      `Billing webhook queue unreachable (REDIS_URL) — processing ${event.type} ${event.id} inline (dev fallback).`,
    );
    return this.processEvent(event);
  }

  /**
   * Apply one verified event: claim its idempotency key and process it in
   * the same transaction, then run post-commit side effects (pushes,
   * provider calls). Throws on failure so the queue retries; a replay of an
   * applied event is a duplicate. Used by the worker and the dev fallback.
   */
  async processEvent(event: StripeWebhookEvent): Promise<WebhookResult> {
    const key = `stripe:${event.id}`;
    const prefetched = await this.prefetch(event);
    let effects: AfterCommit[] = [];
    try {
      const handled = await this.prisma.$transaction(async (tx) => {
        effects = [];
        await claimWebhookEvent(tx, key, 'stripe_webhook');
        return this.process(tx, event, prefetched, effects);
      }, WEBHOOK_TX_OPTIONS);
      await this.runAfterCommit(effects, event);
      return { received: true, duplicate: false, handled };
    } catch (err) {
      if (err instanceof DuplicateWebhookEvent) return DUPLICATE_RESULT;
      throw err;
    }
  }

  /** Network reads for the event, done before (outside) the transaction. */
  private async prefetch(event: StripeWebhookEvent): Promise<Prefetched> {
    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const ctx =
        (await this.billing.resolveChargeContext(charge)) ??
        chargeContextFromPayload(charge);
      const snapshot = isRecurringStripeSubscriptionId(ctx.subscriptionId)
        ? await this.billing.retrieveSubscription(ctx.subscriptionId)
        : null;
      return { snapshot, charge: ctx };
    }
    const id = subscriptionIdOf(event);
    if (!id) return { snapshot: null };
    return { snapshot: await this.billing.retrieveSubscription(id) };
  }

  private async process(
    tx: Tx,
    event: StripeWebhookEvent,
    pre: Prefetched,
    effects: AfterCommit[],
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
      return this.handleInvoice(tx, event, pre, effects);
    }

    if (event.type === 'charge.refunded')
      return this.handleRefund(tx, event, pre, effects);

    if (CHECKOUT_EVENTS.has(event.type))
      return this.handleCheckout(tx, event, pre);

    this.logger.debug(`Ignoring unhandled event type ${event.type}`);
    return false;
  }

  /**
   * invoice.paid → mirror status + first-paid-invoice bonus.
   * invoice.payment_failed → mirror status (PAST_DUE) + a recovery push on
   * the transition into PAST_DUE (Stripe's retries fail again; one push).
   */
  private async handleInvoice(
    tx: Tx,
    event: StripeWebhookEvent,
    pre: Prefetched,
    effects: AfterCommit[],
  ): Promise<boolean> {
    const paid = event.type === 'invoice.paid';
    const subId = pre.snapshot?.id ?? subscriptionIdOf(event);
    if (!subId) return false;
    const statusBefore = (
      await tx.subscription.findUnique({
        where: { stripeSubscriptionId: subId },
        select: { status: true },
      })
    )?.status;

    const applied = pre.snapshot
      ? await this.applySnapshot(tx, pre.snapshot, event, { fromApi: true })
      : await this.setStatusFromInvoice(
          tx,
          subId,
          paid ? 'ACTIVE' : 'PAST_DUE',
          event,
        );

    const row = await tx.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    if (!row) return applied;

    if (paid) {
      const invoice = event.data.object;
      if (!isFirstPaidInvoice(invoice, row)) return applied;
      const granted = await this.grantFirstPaymentBonus(
        tx,
        row,
        `invoice ${idOf(invoice['id']) ?? '?'}`,
      );
      return applied || granted;
    }

    if (row.status === 'PAST_DUE' && statusBefore !== 'PAST_DUE') {
      effects.push({
        kind: 'push',
        userId: row.userId,
        what: 'payment-failed',
        content: ({ locale }) => ({
          ...paymentFailedCopy(locale),
          data: { type: 'billing_payment_failed', subscriptionId: row.id },
        }),
      });
    }
    return applied;
  }

  /**
   * `billing.firstPaymentBonusCoins` once per subscription (docs/09 §5
   * step 7), flat, journaled under `billing_bonus:<subscription row id>` so
   * replays and later invoices never pay it twice. 0 = off.
   */
  private async grantFirstPaymentBonus(
    tx: Tx,
    row: Pick<Subscription, 'id' | 'userId'>,
    reason: string,
  ): Promise<boolean> {
    const coins = await this.config.get('billing.firstPaymentBonusCoins', tx);
    if (coins <= 0) return false;
    const key = firstPaymentBonusKey(row.id);
    if (await this.gamification.alreadyGranted(tx, key)) return false;
    await this.gamification.grantReward(
      {
        userId: row.userId,
        baseXp: 0,
        baseCoins: coins,
        xpSource: 'ADMIN_GRANT',
        coinSource: 'PROMO_CODE',
        refType: 'subscription',
        refId: row.id,
        idempotencyKey: key,
        flat: true,
      },
      tx,
    );
    this.logger.log(
      `First-payment bonus: ${coins} coins → user ${row.userId} (subscription ${row.id}, ${reason})`,
    );
    return true;
  }

  /**
   * charge.refunded (docs/09 §5 "Refunds", §12). Always recorded
   * (AuditLog `billing.refund`). A FULL refund of the subscription's latest
   * invoice — or of a PIX/Boleto prepay — ends access now; a renewing
   * Stripe subscription is also canceled at Stripe after commit so it is
   * not charged again. A full refund within `billing.refundWindowDays` of
   * the first-payment bonus claws the bonus back, capped at the balance.
   */
  private async handleRefund(
    tx: Tx,
    event: StripeWebhookEvent,
    pre: Prefetched,
    effects: AfterCommit[],
  ): Promise<boolean> {
    const charge = event.data.object;
    const ctx = pre.charge ?? chargeContextFromPayload(charge);
    const amount = numberOr(charge['amount'], 0);
    const amountRefunded = numberOr(charge['amount_refunded'], 0);
    const full =
      charge['refunded'] === true || (amount > 0 && amountRefunded >= amount);
    const chargeId = idOf(charge['id']);
    const record = {
      eventId: event.id,
      chargeId,
      amount: amountRefunded,
      chargeAmount: amount,
      currency:
        typeof charge['currency'] === 'string'
          ? charge['currency'].toUpperCase()
          : null,
      full,
      invoiceId: ctx.invoiceId,
      checkoutSessionId: ctx.checkoutSessionId,
      stripeSubscriptionId: ctx.subscriptionId ?? ctx.checkoutSessionId,
    };

    const row = await this.findRefundedSubscription(tx, ctx, charge);
    if (!row) {
      this.logger.warn(
        `charge.refunded ${chargeId ?? '?'} (${event.id}): no subscription resolvable — recorded only`,
      );
      await this.recordRefund(tx, 'Charge', chargeId, {
        ...record,
        resolved: false,
      });
      return false;
    }

    const now = new Date();
    const prepay = !isRecurringStripeSubscriptionId(row.stripeSubscriptionId);
    const latest = prepay
      ? true
      : pre.snapshot?.latestInvoiceId
        ? pre.snapshot.latestInvoiceId === ctx.invoiceId
        : payloadInvoiceIsCurrent(charge['invoice'], row);

    let accessEnded = false;
    if (full && latest && row.currentPeriodEnd > now) {
      await tx.subscription.update({
        where: { id: row.id },
        data: {
          status: 'CANCELED',
          currentPeriodEnd: now,
          canceledAt: now,
          pastDueSince: null,
        },
      });
      accessEnded = true;
      if (
        !prepay &&
        this.billing.mode === 'stripe' &&
        row.stripeSubscriptionId &&
        pre.snapshot?.status !== 'canceled'
      ) {
        effects.push({
          kind: 'cancel_at_provider',
          stripeSubscriptionId: row.stripeSubscriptionId,
        });
      }
    }

    let clawedBack = 0;
    if (full) clawedBack = await this.clawBackBonus(tx, row, eventTime(event));

    await this.recordRefund(tx, 'Subscription', row.id, {
      ...record,
      resolved: true,
      userId: row.userId,
      subscriptionId: row.id,
      latestInvoice: latest,
      accessEnded,
      clawedBack,
    });
    this.logger.log(
      `charge.refunded ${chargeId ?? '?'} → subscription ${row.id}: ${full ? 'full' : 'partial'}, accessEnded=${accessEnded}, clawedBack=${clawedBack}`,
    );
    return true;
  }

  /** Coins clawed back (0 when there was no bonus or the window passed). */
  private async clawBackBonus(
    tx: Tx,
    row: Pick<Subscription, 'id' | 'userId'>,
    refundedAt: Date,
  ): Promise<number> {
    const bonus = await tx.coinTransaction.findUnique({
      where: { idempotencyKey: coinKey(firstPaymentBonusKey(row.id)) },
      select: { delta: true, createdAt: true },
    });
    if (!bonus || bonus.delta <= 0) return 0;
    const windowDays = await this.config.get('billing.refundWindowDays', tx);
    if (refundedAt.getTime() - bonus.createdAt.getTime() > windowDays * DAY_MS)
      return 0;
    const { spent } = await this.gamification.spendCoins(
      {
        userId: row.userId,
        amount: bonus.delta,
        source: 'PURCHASE_REFUND',
        refType: 'subscription',
        refId: row.id,
        idempotencyKey: `billing_bonus_clawback:${row.id}`,
        capAtBalance: true,
      },
      tx,
    );
    return spent;
  }

  private async findRefundedSubscription(
    tx: Tx,
    ctx: ChargeContext,
    charge: Record<string, unknown>,
  ): Promise<Subscription | null> {
    const id = ctx.subscriptionId ?? ctx.checkoutSessionId;
    if (id) {
      return tx.subscription.findUnique({
        where: { stripeSubscriptionId: id },
      });
    }
    // Prepay fallback: the PaymentIntent metadata set at checkout
    // (userId/planId/priceId) → that user's latest prepay row for the plan.
    const meta = stringRecord(charge['metadata']);
    if (meta['userId'] && meta['planId']) {
      return tx.subscription.findFirst({
        where: {
          userId: meta['userId'],
          planId: meta['planId'],
          stripeSubscriptionId: { startsWith: 'cs_' },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  }

  private async recordRefund(
    tx: Tx,
    entity: string,
    entityId: string | null,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action: 'billing.refund',
        entity,
        entityId,
        diff: diff as Prisma.InputJsonValue,
      },
    });
  }

  /** Post-commit side effects. Never throws: the event is already applied. */
  private async runAfterCommit(
    effects: AfterCommit[],
    event: StripeWebhookEvent,
  ): Promise<void> {
    for (const effect of effects) {
      try {
        if (effect.kind === 'push') {
          const res = await this.push.sendToUser(
            effect.userId,
            effect.content,
            { kind: 'BILLING' },
          );
          this.logger.log(
            `${effect.what} push to ${effect.userId} (${event.id}): ${res.status}`,
          );
        } else {
          await this.billing.cancelSubscriptionNow(effect.stripeSubscriptionId);
          this.logger.log(
            `Canceled ${effect.stripeSubscriptionId} at Stripe after a full refund (${event.id})`,
          );
        }
      } catch (err) {
        this.logger.error(
          `post-commit ${effect.kind} for ${event.type} ${event.id} failed: ${(err as Error).message}`,
        );
        reportException(err, {
          tags: {
            job: 'billing-webhook',
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            effect: effect.kind,
          },
        });
      }
    }
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
    const existing = await tx.subscription.findUnique({
      where: { stripeSubscriptionId: sessionId },
      select: { id: true },
    });
    const row = await tx.subscription.upsert({
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
    // A prepay is the subscription's first (and only) payment.
    if (!existing)
      await this.grantFirstPaymentBonus(tx, row, `checkout ${sessionId}`);
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

/**
 * Is this paid invoice the subscription's FIRST paid one? Stripe marks the
 * invoice that starts a subscription `subscription_create`; with a free
 * trial that one is $0, and the first charge is the `subscription_cycle`
 * invoice whose period starts when the trial ends.
 */
export function isFirstPaidInvoice(
  invoice: Record<string, unknown>,
  row: Pick<Subscription, 'trialEndsAt'>,
): boolean {
  if (numberOr(invoice['amount_paid'], 0) <= 0) return false;
  const reason = invoice['billing_reason'];
  if (reason === 'subscription_create') return true;
  if (reason !== 'subscription_cycle' || !row.trialEndsAt) return false;
  const lines = (invoice['lines'] as { data?: unknown[] } | undefined)?.data;
  const firstLine = (lines?.[0] ?? null) as {
    period?: { start?: unknown };
  } | null;
  const start = toDate(firstLine?.period?.start) ?? toDate(invoice['created']);
  return (
    start !== null &&
    Math.abs(start.getTime() - row.trialEndsAt.getTime()) <= DAY_MS
  );
}

/**
 * Payload fallback for what a refunded Charge paid for (dev, or when the
 * API lookup is unavailable): an `invoice` id / expanded invoice (older API
 * versions) and `metadata.checkoutSessionId`.
 */
export function chargeContextFromPayload(
  charge: Record<string, unknown>,
): ChargeContext {
  const inv = charge['invoice'];
  const invObj =
    inv && typeof inv === 'object' ? (inv as Record<string, unknown>) : null;
  const parent = invObj?.['parent'] as
    | { subscription_details?: { subscription?: unknown } | null }
    | null
    | undefined;
  const meta = stringRecord(charge['metadata']);
  return {
    invoiceId: idOf(inv),
    subscriptionId: invObj
      ? (idOf(invObj['subscription']) ??
        idOf(parent?.subscription_details?.subscription))
      : null,
    checkoutSessionId: meta['checkoutSessionId'] ?? null,
  };
}

/**
 * Without the API's `latest_invoice`: an expanded invoice created in the
 * row's current period is the latest; no creation time → assume it is.
 */
function payloadInvoiceIsCurrent(
  inv: unknown,
  row: Pick<Subscription, 'currentPeriodStart'>,
): boolean {
  const created =
    inv && typeof inv === 'object'
      ? toDate((inv as Record<string, unknown>)['created'])
      : null;
  if (!created) return true;
  return created.getTime() >= row.currentPeriodStart.getTime() - DAY_MS;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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
