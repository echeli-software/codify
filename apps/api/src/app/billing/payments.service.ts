import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** One row of the billing history (GET /billing/payments). */
export interface PaymentView {
  id: string;
  provider: PaymentProvider;
  amountCents: number;
  /** ISO 4217, upper-case. */
  currency: string;
  status: PaymentStatus;
  /** card | pix | boleto | store | null (unknown). */
  method: string | null;
  refundedCents: number;
  receiptUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  subscriptionId: string | null;
  planName: string | null;
}

/** Staff view adds the provider reference (invoice / transaction id). */
export interface AdminPaymentView extends PaymentView {
  userId: string;
  externalId: string;
}

export interface PaymentPage<T> {
  items: T[];
  total: number;
}

/** Read side of the Payment ledger (written by the billing webhooks). */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(
    userId: string,
    skip: number,
    take: number,
  ): Promise<PaymentPage<PaymentView>> {
    const page = await this.page(userId, skip, take);
    return {
      total: page.total,
      items: page.items.map(toPublicView),
    };
  }

  async listForUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<PaymentPage<AdminPaymentView>> {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('User not found');
    return this.page(userId, skip, take);
  }

  private async page(
    userId: string,
    skip: number,
    take: number,
  ): Promise<PaymentPage<AdminPaymentView>> {
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: [
          { paidAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip,
        take,
        include: {
          subscription: { select: { plan: { select: { name: true } } } },
        },
      }),
      this.prisma.payment.count({ where: { userId } }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        externalId: r.externalId,
        provider: r.provider,
        amountCents: r.amountCents,
        currency: r.currency,
        status: r.status,
        method: r.method,
        refundedCents: r.refundedCents,
        receiptUrl: r.receiptUrl,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        subscriptionId: r.subscriptionId,
        planName: r.subscription?.plan.name ?? null,
      })),
    };
  }
}

function toPublicView(p: AdminPaymentView): PaymentView {
  return {
    id: p.id,
    provider: p.provider,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    method: p.method,
    refundedCents: p.refundedCents,
    receiptUrl: p.receiptUrl,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    subscriptionId: p.subscriptionId,
    planName: p.planName,
  };
}

/** GET /billing/admin/stripe-status — booleans + paths only, never secrets. */
export interface StripeStatusView {
  /** Which billing provider this API instance runs. */
  mode: 'stripe' | 'dev';
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  revenueCatWebhookConfigured: boolean;
  /** Paths to register in the Stripe / RevenueCat dashboards (append to the API origin). */
  webhookPath: string;
  revenueCatWebhookPath: string;
  /** Absolute URL when API_PUBLIC_URL is set. */
  webhookUrl: string | null;
}

export function stripeStatus(
  mode: 'stripe' | 'dev',
  env: Record<string, string | undefined> = process.env,
): StripeStatusView {
  const set = (k: string) => (env[k]?.trim().length ?? 0) > 0;
  const base = env['API_PUBLIC_URL']?.replace(/\/+$/, '') ?? null;
  return {
    mode,
    secretKeyConfigured: set('STRIPE_SECRET_KEY'),
    webhookSecretConfigured: set('STRIPE_WEBHOOK_SECRET'),
    revenueCatWebhookConfigured: set('REVENUECAT_WEBHOOK_AUTH'),
    webhookPath: '/api/webhooks/stripe',
    revenueCatWebhookPath: '/api/webhooks/revenuecat',
    webhookUrl: base ? `${base}/webhooks/stripe` : null,
  };
}
