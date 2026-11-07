import type { BillingPeriod, Subscription } from '@prisma/client';
import { subscriptionGrantsAccess } from '@codify/domain';
import type {
  AdminSubscriptionResponse,
  SubscriptionResponse,
} from './billing.dto.js';

const DAY_MS = 86_400_000;

/** `start` + one billing period, in calendar terms (UTC). */
export function addBillingPeriod(start: Date, period: BillingPeriod): Date {
  const d = new Date(start.getTime());
  if (period === 'ANNUAL') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * DAY_MS);
}

/** Student-facing view of a subscription row. */
export function toSubscriptionResponse(
  s: Subscription,
  planName: string,
  now: Date,
  graceDays: number,
): SubscriptionResponse {
  return {
    id: s.id,
    planId: s.planId,
    planName,
    status: s.status,
    source: s.source,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    canceledAt: s.canceledAt?.toISOString() ?? null,
    pastDueSince: s.pastDueSince?.toISOString() ?? null,
    renews: isRenewing(s),
    grantsAccess: subscriptionGrantsAccess(
      {
        planId: s.planId,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        pastDueSince: s.pastDueSince,
      },
      now,
      graceDays,
    ),
  };
}

/** Staff view: the student view plus provider identifiers. */
export function toAdminSubscriptionResponse(
  s: Subscription,
  planName: string,
  now: Date,
  graceDays: number,
): AdminSubscriptionResponse {
  return {
    ...toSubscriptionResponse(s, planName, now, graceDays),
    userId: s.userId,
    stripeSubscriptionId: s.stripeSubscriptionId,
    stripeCustomerId: s.stripeCustomerId,
    storeTransactionId: s.storeTransactionId,
    storeProductId: s.storeProductId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Will this subscription renew on its own? False for one-shot PIX/Boleto
 * prepay, admin grants, and anything already set to end.
 */
export function isRenewing(s: Subscription): boolean {
  if (s.cancelAtPeriodEnd) return false;
  if (
    s.status !== 'ACTIVE' &&
    s.status !== 'TRIALING' &&
    s.status !== 'PAST_DUE'
  )
    return false;
  if (s.source === 'ADMIN_GRANT') return false;
  if (s.source === 'STRIPE_WEB')
    return !!s.stripeSubscriptionId?.startsWith('sub_');
  return true; // store subscriptions auto-renew in the store
}
