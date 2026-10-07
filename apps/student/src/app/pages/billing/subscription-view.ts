import type {
  PaymentMethod,
  PlanPrice,
  SubscriptionView,
} from '@codify/api-client';
import { supportsPrepay } from '../shared/plan-view.js';

/** What the subscription screen offers for one subscription (no dark patterns). */
export interface SubscriptionActions {
  /** Web subscription that renews: one clear "Cancel" path. */
  canCancel: boolean;
  /** Pending cancellation of a renewing web subscription, period not over. */
  canResume: boolean;
  /** Bought in a store — cancel / resume happen there. */
  store: 'APPLE' | 'GOOGLE' | null;
  /** Support / admin grant — nothing to manage. */
  grant: boolean;
  /** One-time PIX / Boleto prepay — ends on its own, renew by buying again. */
  prepaid: boolean;
  pastDue: boolean;
  /** Date access ends (or renews), ISO. */
  periodEnd: string;
}

/** The subscription to show: an access-granting one first, then the newest. */
export function currentSubscription(
  subs: readonly SubscriptionView[],
): SubscriptionView | null {
  return (
    subs.find((s) => s.grantsAccess && s.status === 'PAST_DUE') ??
    subs.find((s) => s.grantsAccess) ??
    subs.find((s) => s.status === 'PAST_DUE' || s.status === 'INCOMPLETE') ??
    null
  );
}

export function subscriptionActions(
  sub: SubscriptionView,
  now = Date.now(),
): SubscriptionActions {
  const store =
    sub.source === 'APPLE_IAP'
      ? 'APPLE'
      : sub.source === 'GOOGLE_PLAY'
        ? 'GOOGLE'
        : null;
  const grant = sub.source === 'ADMIN_GRANT';
  const web = sub.source === 'STRIPE_WEB';
  // Prepaid rows are created already set to end (cancelAtPeriodEnd) without
  // a cancellation timestamp; a user cancellation always stamps canceledAt.
  const prepaid =
    web && sub.cancelAtPeriodEnd && !sub.canceledAt && !sub.renews;
  const periodOpen = new Date(sub.currentPeriodEnd).getTime() > now;
  const live = sub.status !== 'CANCELED' && sub.status !== 'INCOMPLETE_EXPIRED';
  return {
    canCancel: web && live && !sub.cancelAtPeriodEnd && sub.renews,
    canResume:
      web && live && sub.cancelAtPeriodEnd && !!sub.canceledAt && periodOpen,
    store,
    grant,
    prepaid,
    pastDue: sub.status === 'PAST_DUE',
    periodEnd:
      sub.trialEndsAt && sub.status === 'TRIALING'
        ? sub.trialEndsAt
        : sub.currentPeriodEnd,
  };
}

/** Payment methods offered for a price (PIX / Boleto: annual BRL only). */
export function methodsFor(
  price: Pick<PlanPrice, 'period' | 'currency'>,
  native: boolean,
): PaymentMethod[] {
  if (native) return [];
  return supportsPrepay(price) ? ['card', 'pix', 'boleto'] : ['card'];
}
