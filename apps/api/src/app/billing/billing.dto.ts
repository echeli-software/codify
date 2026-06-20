import { IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';

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

export interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
  /** 'dev' lets the client know it can self-complete via /billing/dev/... */
  mode: 'dev' | 'stripe';
}

export interface PortalResponse {
  url: string;
}

export interface SubscriptionResponse {
  id: string;
  planId: string;
  planName: string;
  status:
    | 'TRIALING'
    | 'ACTIVE'
    | 'PAST_DUE'
    | 'CANCELED'
    | 'INCOMPLETE'
    | 'INCOMPLETE_EXPIRED'
    | 'UNPAID'
    | 'PAUSED';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  /** Whether this subscription currently grants access (status × window). */
  grantsAccess: boolean;
}

export interface MySubscriptionResponse {
  subscriptions: SubscriptionResponse[];
  /** Plan ids the user currently has access through (convenience for UI). */
  activePlanIds: string[];
}
