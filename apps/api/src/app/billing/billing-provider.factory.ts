import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  DevBillingProvider,
  type BillingProvider,
} from './billing.provider.js';
import {
  StripeBillingProvider,
  type StripeClientLike,
} from './stripe.provider.js';
import {
  DevRevenueCatProvider,
  RevenueCatHttpProvider,
  type RevenueCatProvider,
} from './revenuecat.provider.js';

type Env = Record<string, string | undefined>;

/**
 * Pick the billing provider from the environment (brief §4 pattern):
 * - STRIPE_SECRET_KEY set → StripeBillingProvider (needs STRIPE_WEBHOOK_SECRET
 *   too: an unverifiable webhook endpoint is never acceptable).
 * - otherwise → DevBillingProvider, except in production, where booting
 *   without Stripe throws instead of silently falling back.
 */
export function createBillingProvider(
  env: Env,
  makeClient: (key: string) => StripeClientLike = (key) => new Stripe(key),
): BillingProvider {
  const key = env['STRIPE_SECRET_KEY'];
  const webhookSecret = env['STRIPE_WEBHOOK_SECRET'];
  if (key) {
    if (!webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET must be set when STRIPE_SECRET_KEY is set',
      );
    }
    return new StripeBillingProvider(makeClient(key), webhookSecret);
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      'Billing is not configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in production',
    );
  }
  new Logger('BillingModule').log(
    'STRIPE_SECRET_KEY not set — using DevBillingProvider',
  );
  return new DevBillingProvider(env['DEV_BILLING_SECRET']);
}

/**
 * RevenueCat webhook auth: REVENUECAT_WEBHOOK_AUTH set → verify it;
 * otherwise dev (trusts JSON), except in production, which throws.
 */
export function createRevenueCatProvider(env: Env): RevenueCatProvider {
  const secret = env['REVENUECAT_WEBHOOK_AUTH'];
  if (secret) return new RevenueCatHttpProvider(secret);
  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      'RevenueCat is not configured: set REVENUECAT_WEBHOOK_AUTH in production',
    );
  }
  return new DevRevenueCatProvider();
}
