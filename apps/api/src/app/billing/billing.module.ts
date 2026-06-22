import { Global, Logger, Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';
import {
  BILLING_PROVIDER,
  DevBillingProvider,
  type BillingProvider,
} from './billing.provider.js';
import {
  REVENUECAT_PROVIDER,
  DevRevenueCatProvider,
  RevenueCatHttpProvider,
  type RevenueCatProvider,
} from './revenuecat.provider.js';

/**
 * Global billing module. Provides the BILLING_PROVIDER seam, the reusable
 * AccessService (used by progress enforcement + the paywall query), and the
 * student-facing BillingService.
 *
 * Provider selection: when STRIPE_SECRET_KEY is set we'd wire the real
 * Stripe implementation; until then (and in tests) we use the deterministic
 * DevBillingProvider so the whole flow is exercisable without Stripe keys.
 */
@Global()
@Module({
  controllers: [BillingController, WebhookController],
  providers: [
    AccessService,
    BillingService,
    WebhookService,
    RevenueCatWebhookService,
    {
      provide: BILLING_PROVIDER,
      useFactory: (): BillingProvider => {
        const hasStripe = !!process.env['STRIPE_SECRET_KEY'];
        if (hasStripe) {
          // Phase 6: real StripeBillingProvider lands here once the SDK +
          // keys are wired. Until then fall through to dev with a warning.
          new Logger('BillingModule').warn(
            'STRIPE_SECRET_KEY is set but StripeBillingProvider is not implemented yet — using DevBillingProvider.',
          );
        }
        return new DevBillingProvider();
      },
    },
    {
      provide: REVENUECAT_PROVIDER,
      useFactory: (): RevenueCatProvider => {
        // Verify the shared Authorization secret when configured; otherwise
        // use the dev provider so the store-purchase → access flow works
        // offline (Phase 11). Real native delivery is store-side.
        const secret = process.env['REVENUECAT_WEBHOOK_AUTH'];
        return secret ? new RevenueCatHttpProvider(secret) : new DevRevenueCatProvider();
      },
    },
  ],
  exports: [BILLING_PROVIDER, AccessService, BillingService],
})
export class BillingModule {}
