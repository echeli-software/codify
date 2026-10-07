import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  type StripeWebhookEvent,
} from './billing.provider.js';

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

interface SubscriptionObject {
  id: string;
  customer?: string;
  status?: string;
  current_period_start?: number | string;
  current_period_end?: number | string;
  cancel_at_period_end?: boolean;
  trial_end?: number | string | null;
  canceled_at?: number | string | null;
  metadata?: { userId?: string; planId?: string };
}

interface InvoiceObject {
  subscription?: string;
}

/**
 * Processes Stripe webhook events into our `Subscription` mirror, with
 * Postgres-backed idempotency keyed on the Stripe event id (duplicate
 * deliveries are dropped). See /docs/09-billing.md §6.
 *
 * Real production should enqueue handlers in BullMQ and return 200 to Stripe
 * immediately; here we process inline since the dev provider is synchronous.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
  ) {}

  async handleStripe(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ received: boolean; duplicate: boolean; handled: boolean }> {
    const event = this.billing.constructWebhookEvent(rawBody, signature);
    if (!event) throw new BadRequestException('Invalid webhook payload');

    // Idempotency: the unique key drops replays. Insert first so concurrent
    // duplicate deliveries collide on the PK rather than double-processing.
    const key = `stripe:${event.id}`;
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key, scope: 'stripe_webhook' },
      });
    } catch (err) {
      // Only a unique-key conflict means "already processed" — ack + skip.
      // Anything else is a real failure Stripe should retry on.
      if (isUniqueViolation(err)) {
        return { received: true, duplicate: true, handled: false };
      }
      throw err;
    }

    const handled = await this.process(event);
    return { received: true, duplicate: false, handled };
  }

  private async process(event: StripeWebhookEvent): Promise<boolean> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.upsertSubscription(
          event.data.object as unknown as SubscriptionObject,
        );
      case 'customer.subscription.deleted':
        return this.cancelSubscription(
          event.data.object as unknown as SubscriptionObject,
        );
      case 'invoice.payment_failed':
        return this.setStatusByInvoice(
          event.data.object as unknown as InvoiceObject,
          'PAST_DUE',
        );
      case 'invoice.paid':
        return this.setStatusByInvoice(
          event.data.object as unknown as InvoiceObject,
          'ACTIVE',
        );
      default:
        this.logger.debug(`Ignoring unhandled event type ${event.type}`);
        return false;
    }
  }

  private async upsertSubscription(obj: SubscriptionObject): Promise<boolean> {
    if (!obj.id) return false;
    const status = obj.status ? (STATUS_MAP[obj.status] ?? 'ACTIVE') : 'ACTIVE';
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: obj.id },
    });

    const periodStart =
      toDate(obj.current_period_start) ??
      existing?.currentPeriodStart ??
      new Date();
    const periodEnd =
      toDate(obj.current_period_end) ??
      existing?.currentPeriodEnd ??
      addDays(new Date(), 30);
    const trialEndsAt = toDate(obj.trial_end) ?? existing?.trialEndsAt ?? null;
    const cancelAtPeriodEnd =
      obj.cancel_at_period_end ?? existing?.cancelAtPeriodEnd ?? false;

    if (existing) {
      await this.prisma.subscription.update({
        where: { stripeSubscriptionId: obj.id },
        data: {
          status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt,
          cancelAtPeriodEnd,
        },
      });
      return true;
    }

    // New subscription — needs userId + planId (carried in metadata on the
    // Stripe object, which we set at creation time).
    const userId = obj.metadata?.userId;
    const planId = obj.metadata?.planId;
    if (!userId || !planId) {
      this.logger.warn(
        `subscription.created for ${obj.id} missing userId/planId metadata — skipping`,
      );
      return false;
    }
    const data: Prisma.SubscriptionUncheckedCreateInput = {
      userId,
      planId,
      source: 'STRIPE_WEB',
      stripeSubscriptionId: obj.id,
      stripeCustomerId: obj.customer ?? `cus_${userId}`,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      trialEndsAt,
    };
    await this.prisma.subscription.create({ data });
    return true;
  }

  private async cancelSubscription(obj: SubscriptionObject): Promise<boolean> {
    if (!obj.id) return false;
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: obj.id },
    });
    if (!existing) return false;
    const now = new Date();
    // `subscription.deleted` means the subscription has fully ended — access
    // should stop now. CANCELED grants access until currentPeriodEnd, so we
    // close the period (to the event's end if it supplies one, else now).
    const periodEnd = toDate(obj.current_period_end) ?? now;
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: obj.id },
      data: {
        status: 'CANCELED',
        canceledAt: toDate(obj.canceled_at) ?? now,
        currentPeriodEnd: periodEnd,
      },
    });
    return true;
  }

  private async setStatusByInvoice(
    obj: InvoiceObject,
    status: SubscriptionStatus,
  ): Promise<boolean> {
    if (!obj.subscription) return false;
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: obj.subscription },
    });
    if (!existing) return false;
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: obj.subscription },
      data: { status },
    });
    return true;
  }
}

/** Accept Stripe unix-seconds or ISO strings; null/undefined → null. */
function toDate(v: number | string | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
