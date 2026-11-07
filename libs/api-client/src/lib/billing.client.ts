import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type PaymentMethod = 'card' | 'pix' | 'boleto';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED';

export interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
  mode: 'dev' | 'stripe';
}

export type SubscriptionSource =
  | 'STRIPE_WEB'
  | 'APPLE_IAP'
  | 'GOOGLE_PLAY'
  | 'ADMIN_GRANT';

export interface SubscriptionView {
  id: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  /** Where it was bought; APPLE_IAP / GOOGLE_PLAY must be managed in the store. */
  source: SubscriptionSource;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  canceledAt: string | null;
  pastDueSince: string | null;
  /** Renews automatically (false for PIX/Boleto prepay, grants, or once canceled). */
  renews: boolean;
  grantsAccess: boolean;
}

/** Staff view of a subscription (support/admin endpoints). */
export interface AdminSubscriptionView extends SubscriptionView {
  userId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  storeTransactionId: string | null;
  storeProductId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSubscriptionBody {
  /** Defaults to the user's current subscription. */
  subscriptionId?: string;
  /** Optional, skippable one-question survey answer (cancel only). */
  reason?: string;
}

export interface GrantSubscriptionBody {
  planId: string;
  /** SUPPORT is capped at 31 days. */
  durationDays: number;
  reason?: string;
}

export interface AdminCancelBody {
  mode: 'immediate' | 'period_end';
  reason?: string;
}

export interface MySubscriptionResponse {
  subscriptions: SubscriptionView[];
  activePlanIds: string[];
}

export type PaymentProviderKind = 'STRIPE' | 'APPLE' | 'GOOGLE';
export type PaymentStatus =
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/** One billing-history row (GET /billing/payments), newest first. */
export interface PaymentView {
  id: string;
  provider: PaymentProviderKind;
  amountCents: number;
  /** ISO 4217, upper-case. */
  currency: string;
  status: PaymentStatus;
  /** card | pix | boleto | store | null (unknown). */
  method: string | null;
  refundedCents: number;
  /** Stripe hosted invoice / receipt; null for store purchases. */
  receiptUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  subscriptionId: string | null;
  planName: string | null;
}

/** Staff view adds the provider reference. */
export interface AdminPaymentView extends PaymentView {
  userId: string;
  /** Stripe invoice / Checkout Session id, or the store transaction id. */
  externalId: string;
}

export interface PaymentPage<T> {
  items: T[];
  total: number;
}

/** GET /billing/admin/stripe-status — never contains secrets. */
export interface StripeStatus {
  mode: 'stripe' | 'dev';
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  revenueCatWebhookConfigured: boolean;
  webhookPath: string;
  revenueCatWebhookPath: string;
  /** Absolute webhook URL when the API knows its public URL. */
  webhookUrl: string | null;
}

/** Mirrors @codify/domain AccessResult — the paywall verdict for a lesson. */
export interface LessonAccess {
  granted: boolean;
  reason:
    | 'free_lesson'
    | 'free_course'
    | 'enrollment'
    | 'subscription'
    | 'paywall';
  requiredPlans?: { id: string; slug: string; name: string }[];
}

/**
 * Typed client for /api/billing. In dev mode the checkout is completed
 * locally via `completeDevCheckout` (the stand-in for the Stripe webhook);
 * the success page calls it after Checkout "returns".
 */
@Injectable({ providedIn: 'root' })
export class BillingClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  createCheckout(body: {
    planPriceId: string;
    paymentMethod?: PaymentMethod;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<CheckoutSessionResponse> {
    return firstValueFrom(
      this.http.post<CheckoutSessionResponse>(
        `${this.config.baseUrl}/billing/checkout-session`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  createPortal(returnUrl?: string): Promise<{ url: string }> {
    return firstValueFrom(
      this.http.post<{ url: string }>(
        `${this.config.baseUrl}/billing/portal-session`,
        { returnUrl },
        { context: withIdempotency() },
      ),
    );
  }

  mySubscription(): Promise<MySubscriptionResponse> {
    return firstValueFrom(
      this.http.get<MySubscriptionResponse>(
        `${this.config.baseUrl}/billing/subscription`,
      ),
    );
  }

  lessonAccess(lessonId: string): Promise<LessonAccess> {
    return firstValueFrom(
      this.http.get<LessonAccess>(
        `${this.config.baseUrl}/billing/access/lesson/${encodeURIComponent(lessonId)}`,
      ),
    );
  }

  /** Cancel at period end — access continues until `currentPeriodEnd`. */
  cancelSubscription(
    body: ChangeSubscriptionBody = {},
  ): Promise<SubscriptionView> {
    return firstValueFrom(
      this.http.post<SubscriptionView>(
        `${this.config.baseUrl}/billing/subscription/cancel`,
        body,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  /** Undo a pending cancellation (renewing subscriptions only). */
  resumeSubscription(
    body: ChangeSubscriptionBody = {},
  ): Promise<SubscriptionView> {
    return firstValueFrom(
      this.http.post<SubscriptionView>(
        `${this.config.baseUrl}/billing/subscription/resume`,
        body,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  /** Billing history of the signed-in user, newest first. */
  myPayments(
    page: { skip?: number; take?: number } = {},
  ): Promise<PaymentPage<PaymentView>> {
    return firstValueFrom(
      this.http.get<PaymentPage<PaymentView>>(
        `${this.config.baseUrl}/billing/payments`,
        { params: pageParams(page) },
      ),
    );
  }

  /** SUPPORT/ADMIN: a user's payments (with provider references). */
  adminUserPayments(
    userId: string,
    page: { skip?: number; take?: number } = {},
  ): Promise<PaymentPage<AdminPaymentView>> {
    return firstValueFrom(
      this.http.get<PaymentPage<AdminPaymentView>>(
        `${this.config.baseUrl}/billing/admin/users/${encodeURIComponent(userId)}/payments`,
        { params: pageParams(page) },
      ),
    );
  }

  /** ADMIN: whether Stripe / RevenueCat are configured (booleans only). */
  stripeStatus(): Promise<StripeStatus> {
    return firstValueFrom(
      this.http.get<StripeStatus>(
        `${this.config.baseUrl}/billing/admin/stripe-status`,
      ),
    );
  }

  /** SUPPORT/ADMIN: a user's subscriptions with provider ids. */
  adminUserSubscriptions(
    userId: string,
  ): Promise<{ subscriptions: AdminSubscriptionView[] }> {
    return firstValueFrom(
      this.http.get<{ subscriptions: AdminSubscriptionView[] }>(
        `${this.config.baseUrl}/billing/admin/users/${encodeURIComponent(userId)}/subscriptions`,
      ),
    );
  }

  /** SUPPORT/ADMIN: grant a plan for `durationDays` (non-renewing). */
  adminGrant(
    userId: string,
    body: GrantSubscriptionBody,
  ): Promise<AdminSubscriptionView> {
    return firstValueFrom(
      this.http.post<AdminSubscriptionView>(
        `${this.config.baseUrl}/billing/admin/users/${encodeURIComponent(userId)}/grant`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  /** SUPPORT/ADMIN: cancel now or at period end. */
  adminCancel(
    subscriptionId: string,
    body: AdminCancelBody,
  ): Promise<AdminSubscriptionView> {
    return firstValueFrom(
      this.http.post<AdminSubscriptionView>(
        `${this.config.baseUrl}/billing/admin/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  /** Dev-only: complete a stub checkout session (stands in for the webhook). */
  completeDevCheckout(sessionId: string): Promise<SubscriptionView> {
    return firstValueFrom(
      this.http.post<SubscriptionView>(
        `${this.config.baseUrl}/billing/dev/complete-checkout`,
        { sessionId },
        { context: withIdempotency() },
      ),
    );
  }
}

function pageParams(page: { skip?: number; take?: number }) {
  const params: Record<string, string> = {};
  if (page.skip !== undefined) params['skip'] = String(page.skip);
  if (page.take !== undefined) params['take'] = String(page.take);
  return params;
}
