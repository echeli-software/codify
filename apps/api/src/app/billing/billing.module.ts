import { Global, Logger, Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import {
  BILLING_PROVIDER,
  DevBillingProvider,
  type BillingProvider,
} from './billing.provider.js';

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
  controllers: [BillingController],
  providers: [
    AccessService,
    BillingService,
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
  ],
  exports: [BILLING_PROVIDER, AccessService, BillingService],
})
export class BillingModule {}
