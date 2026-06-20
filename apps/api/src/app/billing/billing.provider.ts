import { Logger } from '@nestjs/common';

/**
 * Payment-provider seam. The rest of the app talks to billing through this
 * interface only, so the real Stripe SDK can be dropped in later without
 * touching controllers/services. Mirrors the auth stub-mode pattern: in
 * dev (no Stripe keys) a deterministic `DevBillingProvider` synthesizes
 * fake-but-coherent Stripe ids and a checkout URL the app can complete
 * locally, so the entire subscribe → access flow is exercisable offline.
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
  }[];
}

export interface SyncPlanResult {
  stripeProductId: string;
  prices: { id: string; stripePriceId: string }[];
}

export interface CheckoutSessionInput {
  user: { id: string; email: string };
  plan: { id: string; name: string; trialDays: number };
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
  customerId: string;
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

export interface BillingProvider {
  readonly mode: 'dev' | 'stripe';
  syncPlan(input: SyncPlanInput): Promise<SyncPlanResult>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
}

const DEV_SESSION_PREFIX = 'cs_dev_';

/** Encode a checkout payload into a stateless dev session id (no sessions table). */
export function encodeDevSession(payload: DevCheckoutPayload): string {
  const json = JSON.stringify(payload);
  return DEV_SESSION_PREFIX + Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode a dev session id; returns null if it isn't a dev session. */
export function decodeDevSession(sessionId: string): DevCheckoutPayload | null {
  if (!sessionId.startsWith(DEV_SESSION_PREFIX)) return null;
  try {
    const json = Buffer.from(sessionId.slice(DEV_SESSION_PREFIX.length), 'base64url').toString('utf8');
    return JSON.parse(json) as DevCheckoutPayload;
  } catch {
    return null;
  }
}

/**
 * Deterministic, offline-completable billing provider for dev/test. Produces
 * stable fake Stripe ids derived from our own uuids, and a checkout URL that
 * round-trips the session payload back to the success page so the app (or a
 * probe) can complete it via `POST /api/billing/dev/complete-checkout`.
 */
export class DevBillingProvider implements BillingProvider {
  readonly mode = 'dev' as const;
  private readonly logger = new Logger(DevBillingProvider.name);

  async syncPlan(input: SyncPlanInput): Promise<SyncPlanResult> {
    const stripeProductId = input.plan.stripeProductId ?? `prod_dev_${short(input.plan.id)}`;
    const prices = input.prices.map((p) => ({
      id: p.id,
      stripePriceId: p.stripePriceId ?? `price_dev_${short(p.id)}`,
    }));
    this.logger.log(`[dev] synced plan ${input.plan.slug} → ${stripeProductId} (${prices.length} prices)`);
    return { stripeProductId, prices };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const sessionId = encodeDevSession({
      userId: input.user.id,
      planId: input.plan.id,
      priceId: input.price.id,
      paymentMethod: input.paymentMethod,
      trialDays: input.plan.trialDays,
      period: input.price.period,
    });
    const sep = input.successUrl.includes('?') ? '&' : '?';
    const url = `${input.successUrl}${sep}session_id=${encodeURIComponent(sessionId)}&dev=1`;
    return { sessionId, url, customerId: `cus_dev_${short(input.user.id)}` };
  }

  async createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult> {
    const sep = input.returnUrl.includes('?') ? '&' : '?';
    return { url: `${input.returnUrl}${sep}portal=dev` };
  }
}

function short(id: string): string {
  return id.replace(/-/g, '').slice(0, 16);
}
