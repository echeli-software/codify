import { BadRequestException, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import {
  snapshotFromStripeSubscription,
  type BillingProvider,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type PortalSessionInput,
  type PortalSessionResult,
  type StripeWebhookEvent,
  type SubscriptionSnapshot,
  type SyncPlanInput,
  type SyncPlanResult,
} from './billing.provider.js';

/** The slice of the Stripe SDK we use — narrow so tests can mock it. */
export type StripeClientLike = Pick<
  Stripe,
  | 'products'
  | 'prices'
  | 'customers'
  | 'checkout'
  | 'billingPortal'
  | 'subscriptions'
  | 'webhooks'
>;

type CheckoutCreateParams = NonNullable<
  Parameters<StripeClientLike['checkout']['sessions']['create']>[0]
>;
type PriceCreateParams = Parameters<StripeClientLike['prices']['create']>[0];

/** How long a PIX QR code stays payable (seconds). */
const PIX_EXPIRES_AFTER_SECONDS = 60 * 60;
/** Boleto voucher validity (calendar days). */
const BOLETO_EXPIRES_AFTER_DAYS = 3;

/**
 * Real Stripe implementation of the billing seam (/docs/09-billing.md §4–§7).
 *
 * - Plans ↔ Products, PlanPrices ↔ recurring Prices (monthly/annual). Stripe
 *   prices are immutable, so a changed amount/currency/interval creates a
 *   new Price and archives the old one.
 * - Card → Checkout in `subscription` mode with the plan's trial; annual
 *   prices that allow parcelamento get card installments enabled.
 * - PIX / Boleto → one-shot annual prepay: Checkout in `payment` mode whose
 *   metadata (userId, planId, priceId) becomes a 1-year non-renewing
 *   Subscription when the payment succeeds (webhook).
 */
export class StripeBillingProvider implements BillingProvider {
  readonly mode = 'stripe' as const;
  private readonly logger = new Logger(StripeBillingProvider.name);

  constructor(
    private readonly stripe: StripeClientLike,
    private readonly webhookSecret: string,
  ) {}

  async syncPlan(input: SyncPlanInput): Promise<SyncPlanResult> {
    const { plan } = input;
    const productFields = {
      name: plan.name,
      ...(plan.description ? { description: plan.description } : {}),
      metadata: { planId: plan.id, slug: plan.slug },
    };
    const product = plan.stripeProductId
      ? await this.stripe.products.update(plan.stripeProductId, productFields)
      : await this.stripe.products.create(productFields);

    const prices: SyncPlanResult['prices'] = [];
    for (const p of input.prices) {
      const wanted = {
        currency: p.currency.toLowerCase(),
        unit_amount: p.amountCents,
        interval:
          p.period === 'ANNUAL' ? ('year' as const) : ('month' as const),
      };
      if (p.stripePriceId) {
        const existing = await this.stripe.prices.retrieve(p.stripePriceId);
        const same =
          existing.currency === wanted.currency &&
          existing.unit_amount === wanted.unit_amount &&
          existing.recurring?.interval === wanted.interval &&
          idOfProduct(existing.product) === product.id;
        if (same) {
          if (existing.active !== p.isActive) {
            await this.stripe.prices.update(p.stripePriceId, {
              active: p.isActive,
            });
          }
          prices.push({ id: p.id, stripePriceId: p.stripePriceId });
          continue;
        }
        // Immutable on Stripe's side: archive and replace.
        await this.stripe.prices.update(p.stripePriceId, { active: false });
      }
      const params: PriceCreateParams = {
        product: product.id,
        currency: wanted.currency,
        unit_amount: wanted.unit_amount,
        recurring: { interval: wanted.interval },
        active: p.isActive,
        metadata: { planId: plan.id, planPriceId: p.id },
      };
      const created = await this.stripe.prices.create(params);
      prices.push({ id: p.id, stripePriceId: created.id });
    }
    this.logger.log(
      `synced plan ${plan.slug} → ${product.id} (${prices.length} prices)`,
    );
    return { stripeProductId: product.id, prices };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const { user, plan, price, paymentMethod } = input;
    const customer = await this.resolveCustomer(input);
    const metadata = {
      userId: user.id,
      planId: plan.id,
      priceId: price.id,
      period: price.period,
      paymentMethod,
    };
    const successUrl = withSessionPlaceholder(input.successUrl);

    let params: CheckoutCreateParams;
    if (paymentMethod === 'card') {
      if (!price.stripePriceId) {
        throw new BadRequestException(
          'This plan price has not been synced to Stripe yet',
        );
      }
      const installments =
        price.period === 'ANNUAL' && (price.maxInstallments ?? 0) >= 2;
      params = {
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        line_items: [{ price: price.stripePriceId, quantity: 1 }],
        allowed_payment_method_types: ['card'],
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: input.cancelUrl,
        metadata,
        subscription_data: {
          metadata,
          ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
        },
        ...(installments
          ? {
              payment_method_options: {
                card: { installments: { enabled: true } },
              },
            }
          : {}),
      };
    } else {
      // PIX / Boleto: one-shot annual prepay (docs/09 §4 "PIX & subscriptions", "Boleto").
      if (price.period !== 'ANNUAL' || price.currency.toUpperCase() !== 'BRL') {
        throw new BadRequestException(
          'PIX and Boleto are only available for the BRL annual plan',
        );
      }
      params = {
        mode: 'payment',
        customer,
        client_reference_id: user.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: price.amountCents,
              ...(plan.stripeProductId
                ? { product: plan.stripeProductId }
                : { product_data: { name: plan.name } }),
            },
          },
        ],
        allowed_payment_method_types: [paymentMethod],
        success_url: successUrl,
        cancel_url: input.cancelUrl,
        metadata,
        payment_intent_data: { metadata },
        payment_method_options:
          paymentMethod === 'pix'
            ? { pix: { expires_after_seconds: PIX_EXPIRES_AFTER_SECONDS } }
            : { boleto: { expires_after_days: BOLETO_EXPIRES_AFTER_DAYS } },
      };
    }

    const session = await this.stripe.checkout.sessions.create(params);
    if (!session.url)
      throw new Error(
        `Stripe returned no URL for checkout session ${session.id}`,
      );
    return { sessionId: session.id, url: session.url, customerId: customer };
  }

  async createPortalSession(
    input: PortalSessionInput,
  ): Promise<PortalSessionResult> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  constructWebhookEvent(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): StripeWebhookEvent | null {
    if (!signature)
      throw new BadRequestException('Missing Stripe-Signature header');
    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
      return event as unknown as StripeWebhookEvent;
    } catch (err) {
      this.logger.warn(`Stripe webhook rejected: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
  }

  async retrieveSubscription(id: string): Promise<SubscriptionSnapshot | null> {
    try {
      return snapshotFromStripeSubscription(
        await this.stripe.subscriptions.retrieve(id),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'resource_missing') return null;
      throw err;
    }
  }

  async setCancelAtPeriodEnd(
    id: string,
    cancel: boolean,
  ): Promise<SubscriptionSnapshot | null> {
    return snapshotFromStripeSubscription(
      await this.stripe.subscriptions.update(id, {
        cancel_at_period_end: cancel,
      }),
    );
  }

  async cancelSubscriptionNow(
    id: string,
  ): Promise<SubscriptionSnapshot | null> {
    return snapshotFromStripeSubscription(
      await this.stripe.subscriptions.cancel(id),
    );
  }

  /**
   * Reuse the user's Stripe customer: the one on their earlier
   * subscriptions, else one tagged with their user id, else a new one.
   * Creating eagerly keeps one customer per user even across abandoned
   * checkouts, and gives every session (incl. PIX/Boleto) a customer.
   */
  private async resolveCustomer(input: CheckoutSessionInput): Promise<string> {
    if (input.customerId && !input.customerId.startsWith('cus_dev_'))
      return input.customerId;
    const existing = await this.stripe.customers.list({
      email: input.user.email,
      limit: 10,
    });
    const mine = existing.data.find(
      (c) => c.metadata?.['userId'] === input.user.id,
    );
    if (mine) return mine.id;
    const created = await this.stripe.customers.create({
      email: input.user.email,
      metadata: { userId: input.user.id },
    });
    return created.id;
  }
}

function idOfProduct(p: unknown): string | null {
  if (typeof p === 'string') return p;
  return p && typeof p === 'object'
    ? ((p as { id?: string }).id ?? null)
    : null;
}

/** Stripe substitutes `{CHECKOUT_SESSION_ID}` in the success URL. */
function withSessionPlaceholder(url: string): string {
  if (url.includes('{CHECKOUT_SESSION_ID}')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
}
