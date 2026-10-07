import { Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Payment-provider seam. The rest of the app talks to billing through this
 * interface only. `StripeBillingProvider` (stripe.provider.ts) is selected
 * when STRIPE_SECRET_KEY is set; otherwise the deterministic
 * `DevBillingProvider` synthesizes fake-but-coherent Stripe ids and a
 * checkout URL the app can complete locally, so the entire subscribe →
 * access flow is exercisable offline. Production refuses to boot without
 * Stripe (see billing-provider.factory.ts).
 *
 * See /docs/09-billing.md §4–§7.
 */

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';
export type PaymentMethod = 'card' | 'pix' | 'boleto';

export interface SyncPlanInput {
  plan: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    stripeProductId: string | null;
  };
  prices: {
    id: string;
    currency: string;
    amountCents: number;
    period: BillingPeriod;
    maxInstallments: number | null;
    stripePriceId: string | null;
    isActive: boolean;
  }[];
}

export interface SyncPlanResult {
  stripeProductId: string;
  prices: { id: string; stripePriceId: string }[];
}

export interface CheckoutSessionInput {
  user: { id: string; email: string };
  /** Stripe customer to reuse (from the user's earlier subscriptions). */
  customerId: string | null;
  plan: {
    id: string;
    name: string;
    trialDays: number;
    stripeProductId: string | null;
  };
  price: {
    id: string;
    stripePriceId: string | null;
    currency: string;
    amountCents: number;
    period: BillingPeriod;
    maxInstallments: number | null;
  };
  paymentMethod: PaymentMethod;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
  customerId: string | null;
}

export interface PortalSessionInput {
  user: { id: string };
  customerId: string;
  returnUrl: string;
}

export interface PortalSessionResult {
  url: string;
}

/** Decoded payload carried inside a dev checkout-session id. */
export interface DevCheckoutPayload {
  userId: string;
  planId: string;
  priceId: string;
  paymentMethod: PaymentMethod;
  trialDays: number;
  period: BillingPeriod;
}

/** Minimal shape of the Stripe events we act on. */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  /** Unix seconds when Stripe created the event. */
  created?: number;
  data: { object: Record<string, unknown> };
}

/**
 * Provider-neutral view of a Stripe Subscription. Built either from the
 * API (authoritative, current) or from an event payload.
 */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string | null;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  trialEnd: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  /** Stripe Price ids on the subscription items (→ PlanPrice → Plan). */
  priceIds: string[];
  metadata: Record<string, string>;
}

export interface BillingProvider {
  readonly mode: 'dev' | 'stripe';
  syncPlan(input: SyncPlanInput): Promise<SyncPlanResult>;
  createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
  /**
   * Verify + parse an incoming webhook. In Stripe mode this is
   * `stripe.webhooks.constructEvent(rawBody, signature, secret)` and throws
   * on a missing/bad signature. The dev provider trusts the parsed JSON.
   * Returns null when the payload can't be parsed.
   */
  constructWebhookEvent(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): StripeWebhookEvent | null;
  /**
   * Current state of a subscription from the provider's API (Stripe mode).
   * Webhook handlers apply this instead of the event payload, which makes
   * them immune to out-of-order delivery. Dev returns null (no API): the
   * handler falls back to the payload with a staleness guard.
   */
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot | null>;
  /** Toggle auto-renew. Dev returns null (the caller just flips the flag). */
  setCancelAtPeriodEnd(
    id: string,
    cancel: boolean,
  ): Promise<SubscriptionSnapshot | null>;
  /** End a subscription now. Dev returns null. */
  cancelSubscriptionNow(id: string): Promise<SubscriptionSnapshot | null>;
}

/**
 * True for a renewing Stripe subscription id (`sub_…`). One-shot PIX /
 * Boleto annual prepay rows store their Checkout Session id (`cs_…`)
 * instead, so they're never sent to the Subscriptions API.
 */
export function isRecurringStripeSubscriptionId(
  id: string | null | undefined,
): id is string {
  return !!id && id.startsWith('sub_');
}

// ─── Dev checkout sessions (HMAC-signed) ──────────────────────────────

const DEV_SESSION_PREFIX = 'cs_dev_';

/**
 * Encode a checkout payload into a stateless dev session id:
 * `cs_dev_<base64url(json)>.<base64url(hmac-sha256)>`. The signature
 * stops a student from forging a session for another plan/period.
 */
export function encodeDevSession(
  payload: DevCheckoutPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${DEV_SESSION_PREFIX}${body}.${signDev(body, secret)}`;
}

/** Decode + verify a dev session id; null if it isn't one or the signature is wrong. */
export function decodeDevSession(
  sessionId: string,
  secret: string,
): DevCheckoutPayload | null {
  if (!sessionId.startsWith(DEV_SESSION_PREFIX)) return null;
  const rest = sessionId.slice(DEV_SESSION_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const given = Buffer.from(rest.slice(dot + 1), 'base64url');
  const expected = Buffer.from(signDev(body, secret), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as DevCheckoutPayload;
    return parsed &&
      typeof parsed.userId === 'string' &&
      typeof parsed.planId === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function signDev(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Deterministic, offline-completable billing provider for dev/test. Produces
 * stable fake Stripe ids derived from our own uuids, and a checkout URL that
 * round-trips the (signed) session back to the success page so the app (or a
 * probe) can complete it via `POST /api/billing/dev/complete-checkout`.
 */
export class DevBillingProvider implements BillingProvider {
  readonly mode = 'dev' as const;
  private readonly logger = new Logger(DevBillingProvider.name);
  private readonly secret: string;

  /** `secret` = DEV_BILLING_SECRET; random per process when unset. */
  constructor(secret?: string) {
    this.secret = secret || randomBytes(32).toString('hex');
  }

  /** Verify a dev session id minted by this provider. */
  verifySession(sessionId: string): DevCheckoutPayload | null {
    return decodeDevSession(sessionId, this.secret);
  }

  async syncPlan(input: SyncPlanInput): Promise<SyncPlanResult> {
    const stripeProductId =
      input.plan.stripeProductId ?? `prod_dev_${short(input.plan.id)}`;
    const prices = input.prices.map((p) => ({
      id: p.id,
      stripePriceId: p.stripePriceId ?? `price_dev_${short(p.id)}`,
    }));
    this.logger.log(
      `[dev] synced plan ${input.plan.slug} → ${stripeProductId} (${prices.length} prices)`,
    );
    return { stripeProductId, prices };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const sessionId = encodeDevSession(
      {
        userId: input.user.id,
        planId: input.plan.id,
        priceId: input.price.id,
        paymentMethod: input.paymentMethod,
        trialDays: input.plan.trialDays,
        period: input.price.period,
      },
      this.secret,
    );
    const sep = input.successUrl.includes('?') ? '&' : '?';
    const url = `${input.successUrl}${sep}session_id=${encodeURIComponent(sessionId)}&dev=1`;
    return {
      sessionId,
      url,
      customerId: input.customerId ?? `cus_dev_${short(input.user.id)}`,
    };
  }

  async createPortalSession(
    input: PortalSessionInput,
  ): Promise<PortalSessionResult> {
    const sep = input.returnUrl.includes('?') ? '&' : '?';
    return { url: `${input.returnUrl}${sep}portal=dev` };
  }

  constructWebhookEvent(rawBody: Buffer | string): StripeWebhookEvent | null {
    // No signature to verify in dev — trust the parsed JSON.
    try {
      const parsed = JSON.parse(rawBody.toString());
      if (
        parsed &&
        typeof parsed.id === 'string' &&
        typeof parsed.type === 'string'
      ) {
        return parsed as StripeWebhookEvent;
      }
      return null;
    } catch {
      return null;
    }
  }

  async retrieveSubscription(): Promise<SubscriptionSnapshot | null> {
    return null;
  }

  async setCancelAtPeriodEnd(): Promise<SubscriptionSnapshot | null> {
    return null;
  }

  async cancelSubscriptionNow(): Promise<SubscriptionSnapshot | null> {
    return null;
  }
}

function short(id: string): string {
  return id.replace(/-/g, '').slice(0, 16);
}

// ─── Stripe object normalisation (shared by the provider + webhook) ──────

/** Accept Stripe unix-seconds or ISO strings; null/undefined → null. */
export function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v * 1000);
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A Stripe expandable field: the id string, or the expanded object's id. */
export function idOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (
    v &&
    typeof v === 'object' &&
    typeof (v as { id?: unknown }).id === 'string'
  ) {
    return (v as { id: string }).id;
  }
  return null;
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/**
 * Normalise a Stripe Subscription object. Since API 2025-03-31 the billing
 * period lives on the subscription items; older payloads (and our dev
 * probes) carry it at the top level — both are accepted.
 */
export function snapshotFromStripeSubscription(
  obj: unknown,
): SubscriptionSnapshot | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o['id'] !== 'string') return null;
  const items = ((o['items'] as { data?: unknown[] } | undefined)?.data ??
    []) as Record<string, unknown>[];
  const itemStarts = items
    .map((i) => toDate(i['current_period_start']))
    .filter(isDate);
  const itemEnds = items
    .map((i) => toDate(i['current_period_end']))
    .filter(isDate);
  const priceIds = items
    .map((i) => idOf(i['price']))
    .filter((p): p is string => typeof p === 'string');
  return {
    id: o['id'],
    customerId: idOf(o['customer']),
    status: typeof o['status'] === 'string' ? o['status'] : '',
    currentPeriodStart:
      toDate(o['current_period_start']) ??
      (itemStarts.length ? minDate(itemStarts) : null),
    currentPeriodEnd:
      toDate(o['current_period_end']) ??
      (itemEnds.length ? minDate(itemEnds) : null),
    cancelAtPeriodEnd:
      typeof o['cancel_at_period_end'] === 'boolean'
        ? o['cancel_at_period_end']
        : null,
    trialEnd: toDate(o['trial_end']),
    canceledAt: toDate(o['canceled_at']),
    endedAt: toDate(o['ended_at']),
    priceIds,
    metadata: stringRecord(o['metadata']),
  };
}

function isDate(d: Date | null): d is Date {
  return d !== null;
}

function minDate(ds: Date[]): Date {
  return new Date(Math.min(...ds.map((d) => d.getTime())));
}
