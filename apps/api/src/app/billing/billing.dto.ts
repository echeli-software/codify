import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

const PAYMENT_METHODS = ['card', 'pix', 'boleto'] as const;

export class CreateCheckoutDto {
  @IsString()
  @Length(1, 100)
  planPriceId!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  /** Override return URLs (else defaults derived from STUDENT_APP_URL). */
  @IsOptional()
  @IsUrl({ require_tld: false })
  successUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;
}

export class PortalSessionDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}

/** Dev-only: complete a stub checkout session (stands in for the webhook). */
export class CompleteDevCheckoutDto {
  @IsString()
  @Length(1, 4000)
  sessionId!: string;
}

/**
 * Self-serve cancel / resume (docs/09 §5 Cancellation — single confirm,
 * optional skippable one-question survey).
 */
export class ChangeSubscriptionDto {
  /** Which subscription; defaults to the user's current one. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subscriptionId?: string;

  /** Optional survey answer ("why are you leaving?"). Recorded in the audit log. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

/** Support/admin: grant a plan for a fixed number of days. */
export class GrantSubscriptionDto {
  @IsString()
  @Length(1, 100)
  planId!: string;

  /** SUPPORT is capped at 31 days (docs/14 §2); ADMIN up to ~10 years. */
  @IsInt()
  @Min(1)
  @Max(3660)
  durationDays!: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

const ADMIN_CANCEL_MODES = ['immediate', 'period_end'] as const;
export type AdminCancelMode = (typeof ADMIN_CANCEL_MODES)[number];

export class AdminCancelSubscriptionDto {
  @IsIn(ADMIN_CANCEL_MODES)
  mode!: AdminCancelMode;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
  /** 'dev' lets the client know it can self-complete via /billing/dev/... */
  mode: 'dev' | 'stripe';
}

export interface PortalResponse {
  url: string;
}

export type SubscriptionStatusValue =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED';

export type SubscriptionSourceValue =
  | 'STRIPE_WEB'
  | 'APPLE_IAP'
  | 'GOOGLE_PLAY'
  | 'ADMIN_GRANT';

export interface SubscriptionResponse {
  id: string;
  planId: string;
  planName: string;
  status: SubscriptionStatusValue;
  source: SubscriptionSourceValue;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  canceledAt: string | null;
  pastDueSince: string | null;
  /** Renews automatically (false for PIX/Boleto prepay, grants, or once canceled). */
  renews: boolean;
  /** Whether this subscription currently grants access (status × window). */
  grantsAccess: boolean;
}

export interface MySubscriptionResponse {
  subscriptions: SubscriptionResponse[];
  /** Plan ids the user currently has access through (convenience for UI). */
  activePlanIds: string[];
}

export interface AdminSubscriptionResponse extends SubscriptionResponse {
  userId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  storeTransactionId: string | null;
  storeProductId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSubscriptionListResponse {
  subscriptions: AdminSubscriptionResponse[];
}
