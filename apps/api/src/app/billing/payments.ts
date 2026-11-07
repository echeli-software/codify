import type {
  Payment,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { idOf, toDate } from './billing.provider.js';

type Tx = Prisma.TransactionClient;

/**
 * Payment ledger writes from provider webhooks (docs/09 §6 "log payment",
 * "record refund"; docs/05 Subscription → Billing history). Every write is
 * an upsert on `Payment.externalId` inside the webhook's transaction, so
 * replays and out-of-order deliveries converge:
 *
 *  - a PAID invoice is never downgraded to FAILED by a late
 *    `invoice.payment_failed` (an earlier attempt);
 *  - `refundedCents` only grows; status is derived from it (REFUNDED when
 *    the whole amount is back, PARTIALLY_REFUNDED otherwise);
 *  - a late `invoice.paid` keeps any refund already recorded.
 *
 * External ids: Stripe invoice id (`in_…`) for invoices; the Checkout
 * Session id (`cs_…`) for PIX/Boleto prepay; the charge id (`ch_…`) only
 * for a refund whose invoice/session cannot be resolved. Store purchases
 * use the store transaction id of that purchase (not the original one).
 */

export type PaymentMethodKind = 'card' | 'pix' | 'boleto' | 'store';
const KNOWN_METHODS = new Set(['card', 'pix', 'boleto']);

export interface PaymentFacts {
  userId: string;
  subscriptionId: string | null;
  provider: PaymentProvider;
  externalId: string;
  amountCents: number;
  currency: string;
  method: string | null;
  receiptUrl: string | null;
  paidAt: Date | null;
}

/** Status from what was paid and what came back. */
export function refundStatus(
  amountCents: number,
  refundedCents: number,
  base: 'PAID' | 'FAILED',
): PaymentStatus {
  if (refundedCents > 0)
    return amountCents > 0 && refundedCents >= amountCents
      ? 'REFUNDED'
      : 'PARTIALLY_REFUNDED';
  return base;
}

/** A successful charge (invoice.paid, prepay checkout, store purchase/renewal). */
export async function recordPaid(tx: Tx, f: PaymentFacts): Promise<Payment> {
  const existing = await tx.payment.findUnique({
    where: { externalId: f.externalId },
  });
  if (!existing) {
    return tx.payment.create({
      data: { ...f, status: 'PAID', currency: f.currency.toUpperCase() },
    });
  }
  const amountCents = f.amountCents > 0 ? f.amountCents : existing.amountCents;
  return tx.payment.update({
    where: { id: existing.id },
    data: {
      amountCents,
      currency: f.currency.toUpperCase(),
      method: f.method ?? existing.method,
      receiptUrl: f.receiptUrl ?? existing.receiptUrl,
      paidAt: f.paidAt ?? existing.paidAt,
      subscriptionId: existing.subscriptionId ?? f.subscriptionId,
      status: refundStatus(amountCents, existing.refundedCents, 'PAID'),
    },
  });
}

/** A failed attempt; never overrides a payment that already succeeded. */
export async function recordFailed(
  tx: Tx,
  f: Omit<PaymentFacts, 'paidAt'>,
): Promise<Payment | null> {
  const existing = await tx.payment.findUnique({
    where: { externalId: f.externalId },
  });
  if (!existing) {
    return tx.payment.create({
      data: {
        ...f,
        currency: f.currency.toUpperCase(),
        status: 'FAILED',
        paidAt: null,
      },
    });
  }
  if (existing.status !== 'FAILED') return null;
  return tx.payment.update({
    where: { id: existing.id },
    data: {
      amountCents: f.amountCents > 0 ? f.amountCents : existing.amountCents,
      method: f.method ?? existing.method,
      receiptUrl: f.receiptUrl ?? existing.receiptUrl,
    },
  });
}

/**
 * A (partial) refund. `refundedCents` is the provider's cumulative refunded
 * amount; when no row exists yet (refund delivered before the payment) one
 * is created from the charge facts.
 */
export async function recordRefund(
  tx: Tx,
  f: PaymentFacts & { refundedCents: number },
): Promise<Payment> {
  const existing = await tx.payment.findUnique({
    where: { externalId: f.externalId },
  });
  if (!existing) {
    return tx.payment.create({
      data: {
        ...f,
        currency: f.currency.toUpperCase(),
        status: refundStatus(f.amountCents, f.refundedCents, 'PAID'),
      },
    });
  }
  const refundedCents = Math.max(existing.refundedCents, f.refundedCents);
  return tx.payment.update({
    where: { id: existing.id },
    data: {
      refundedCents,
      method: existing.method ?? f.method,
      receiptUrl: existing.receiptUrl ?? f.receiptUrl,
      subscriptionId: existing.subscriptionId ?? f.subscriptionId,
      status: refundStatus(existing.amountCents, refundedCents, 'PAID'),
    },
  });
}

// ─── Stripe payload readers ──────────────────────────────────────────────

/**
 * card / pix / boleto from whatever the event carries: a Charge's
 * `payment_method_details.type`, an expanded PaymentIntent (latest charge
 * or a single `payment_method_types` entry), or a Checkout Session's
 * single `payment_method_types` entry. Null when it can't be told.
 */
export function stripeMethodOf(obj: Record<string, unknown>): string | null {
  const fromCharge = (c: unknown): string | null => {
    if (!c || typeof c !== 'object') return null;
    const details = (c as Record<string, unknown>)['payment_method_details'] as
      | { type?: unknown }
      | undefined;
    return typeof details?.type === 'string' ? details.type : null;
  };
  const single = (types: unknown): string | null =>
    Array.isArray(types) && types.length === 1 && typeof types[0] === 'string'
      ? types[0]
      : null;

  let raw = fromCharge(obj) ?? fromCharge(obj['charge']);
  const pi = obj['payment_intent'];
  if (!raw && pi && typeof pi === 'object') {
    const p = pi as Record<string, unknown>;
    raw = fromCharge(p['latest_charge']) ?? single(p['payment_method_types']);
  }
  if (!raw) {
    // Newer API versions: invoice.payments.data[].payment.payment_intent.
    const payments = (obj['payments'] as { data?: unknown[] } | undefined)
      ?.data;
    const first = payments?.[0] as
      | { payment?: { payment_intent?: unknown } }
      | undefined;
    const nested = first?.payment?.payment_intent;
    if (nested && typeof nested === 'object') {
      const p = nested as Record<string, unknown>;
      raw = fromCharge(p['latest_charge']) ?? single(p['payment_method_types']);
    }
  }
  if (!raw) raw = single(obj['payment_method_types']);
  return raw && KNOWN_METHODS.has(raw) ? raw : null;
}

export function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function currencyOf(obj: Record<string, unknown>): string {
  return typeof obj['currency'] === 'string'
    ? obj['currency'].toUpperCase()
    : 'BRL';
}

/** Invoice facts (amount: paid for invoice.paid, due for payment_failed). */
export function invoiceFacts(
  invoice: Record<string, unknown>,
  paid: boolean,
): Pick<
  PaymentFacts,
  'externalId' | 'amountCents' | 'currency' | 'method' | 'receiptUrl' | 'paidAt'
> | null {
  const externalId = idOf(invoice['id']);
  if (!externalId) return null;
  const transitions = invoice['status_transitions'] as
    | { paid_at?: unknown }
    | undefined;
  return {
    externalId,
    amountCents: numberOr(
      paid ? invoice['amount_paid'] : invoice['amount_due'],
      0,
    ),
    currency: currencyOf(invoice),
    method: stripeMethodOf(invoice),
    receiptUrl:
      typeof invoice['hosted_invoice_url'] === 'string'
        ? invoice['hosted_invoice_url']
        : null,
    paidAt: paid ? toDate(transitions?.paid_at) : null,
  };
}
