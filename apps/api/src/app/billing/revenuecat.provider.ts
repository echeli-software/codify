import { Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison is fixed-length and neither the secret's length nor a
 * matching prefix leaks through timing.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * RevenueCat webhook seam. RevenueCat is the cross-store IAP layer (App Store
 * + Play): products mirror our Stripe plans, and its entitlement webhook is
 * the source of truth that syncs store purchases into our `Subscription`
 * mirror — the same table Stripe writes to, so access resolution is identical
 * regardless of where the user paid. See /docs/17-mobile.md.
 *
 * Mirrors the BillingProvider pattern: in prod we verify the shared
 * Authorization secret RevenueCat is configured to send; in dev (no secret) a
 * DevRevenueCatProvider trusts the parsed JSON so the whole store-purchase →
 * entitlement → access flow is exercisable offline.
 */

export const REVENUECAT_PROVIDER = Symbol('REVENUECAT_PROVIDER');

export type RcStore =
  | 'APP_STORE'
  | 'PLAY_STORE'
  | 'STRIPE'
  | 'PROMOTIONAL'
  | string;
export type RcPeriodType = 'TRIAL' | 'INTRO' | 'NORMAL' | string;

/** The event types RevenueCat posts; we act on the subscription-lifecycle ones. */
export type RcEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'PRODUCT_CHANGE'
  | 'UNCANCELLATION'
  | 'CANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | string;

/** The `event` object inside a RevenueCat webhook payload (fields we use). */
export interface RcEvent {
  id: string;
  type: RcEventType;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[] | null;
  period_type?: RcPeriodType;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  /** When RevenueCat emitted the event (unix ms). */
  event_timestamp_ms?: number | null;
  store?: RcStore;
  transaction_id?: string;
  original_transaction_id?: string;
  environment?: 'SANDBOX' | 'PRODUCTION' | string;
}

/** RevenueCat posts `{ api_version, event }`. */
export interface RcWebhookPayload {
  api_version?: string;
  event: RcEvent;
}

export interface RevenueCatProvider {
  readonly mode: 'dev' | 'revenuecat';
  /**
   * Verify the request is genuinely from RevenueCat and return the parsed
   * event, or null if auth fails / the body is malformed. In prod this checks
   * the Authorization header against the configured shared secret; the dev
   * provider trusts the parsed JSON (no secret).
   */
  constructEvent(
    rawBody: string,
    authHeader: string | undefined,
  ): RcEvent | null;
}

export class DevRevenueCatProvider implements RevenueCatProvider {
  readonly mode = 'dev' as const;
  private readonly logger = new Logger(DevRevenueCatProvider.name);

  constructEvent(rawBody: string): RcEvent | null {
    try {
      const parsed = JSON.parse(rawBody) as RcWebhookPayload | RcEvent;
      // Accept either the wrapped `{ event }` shape or a bare event.
      const event = (parsed as RcWebhookPayload).event ?? (parsed as RcEvent);
      if (
        event &&
        typeof event.id === 'string' &&
        typeof event.type === 'string' &&
        typeof event.app_user_id === 'string'
      ) {
        return event;
      }
      this.logger.warn('RevenueCat dev payload missing id/type/app_user_id');
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Production RevenueCat provider: authenticates via the shared Authorization
 * secret configured in the RevenueCat dashboard (RevenueCat does not sign
 * payloads — the secret header is the documented mechanism).
 */
export class RevenueCatHttpProvider implements RevenueCatProvider {
  readonly mode = 'revenuecat' as const;
  private readonly logger = new Logger(RevenueCatHttpProvider.name);

  constructor(private readonly authSecret: string) {}

  constructEvent(
    rawBody: string,
    authHeader: string | undefined,
  ): RcEvent | null {
    if (!authHeader || !constantTimeEquals(authHeader, this.authSecret)) {
      this.logger.warn('RevenueCat webhook rejected: bad Authorization header');
      return null;
    }
    try {
      const parsed = JSON.parse(rawBody) as RcWebhookPayload;
      const event = parsed.event;
      if (
        event &&
        typeof event.id === 'string' &&
        typeof event.type === 'string'
      ) {
        return event;
      }
      return null;
    } catch {
      return null;
    }
  }
}
