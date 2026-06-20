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

export interface SubscriptionView {
  id: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  grantsAccess: boolean;
}

export interface MySubscriptionResponse {
  subscriptions: SubscriptionView[];
  activePlanIds: string[];
}

/** Mirrors @codify/domain AccessResult — the paywall verdict for a lesson. */
export interface LessonAccess {
  granted: boolean;
  reason: 'free_lesson' | 'free_course' | 'enrollment' | 'subscription' | 'paywall';
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
      this.http.get<MySubscriptionResponse>(`${this.config.baseUrl}/billing/subscription`),
    );
  }

  lessonAccess(lessonId: string): Promise<LessonAccess> {
    return firstValueFrom(
      this.http.get<LessonAccess>(
        `${this.config.baseUrl}/billing/access/lesson/${encodeURIComponent(lessonId)}`,
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
