import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../common/queue.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccessService } from './access.service.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { BillingAdminService } from './billing-admin.service.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';
import { BILLING_PROVIDER, type BillingProvider } from './billing.provider.js';
import {
  REVENUECAT_PROVIDER,
  type RevenueCatProvider,
} from './revenuecat.provider.js';
import {
  createBillingProvider,
  createRevenueCatProvider,
} from './billing-provider.factory.js';
import {
  BILLING_WEBHOOK_ENQUEUER,
  BILLING_WEBHOOK_QUEUE,
} from './webhook-queue.js';
import { BullWebhookEnqueuer } from './bull-webhook-enqueuer.js';
import { WebhookProcessor } from './webhook.processor.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { BillingScheduler } from './billing.scheduler.js';

/**
 * Global billing module. Provides the BILLING_PROVIDER seam, the reusable
 * AccessService (used by progress enforcement + the paywall query), and the
 * student-facing + support/admin billing services.
 *
 * Provider selection (billing-provider.factory.ts): STRIPE_SECRET_KEY set →
 * StripeBillingProvider; otherwise the deterministic DevBillingProvider —
 * except in production, where a missing Stripe (or RevenueCat) config
 * fails boot instead of silently falling back.
 *
 * Stripe webhooks are verified in the request and applied by a BullMQ
 * worker (`billing-webhooks` queue on the shared QueueModule connection);
 * BillingScheduler runs the daily subscription sweeper + PIX renewal
 * reminders.
 */
@Global()
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: BILLING_WEBHOOK_QUEUE }),
    NotificationsModule,
  ],
  controllers: [BillingController, WebhookController],
  providers: [
    AccessService,
    BillingService,
    BillingAdminService,
    WebhookService,
    WebhookProcessor,
    { provide: BILLING_WEBHOOK_ENQUEUER, useClass: BullWebhookEnqueuer },
    BillingJobsService,
    BillingScheduler,
    RevenueCatWebhookService,
    {
      provide: BILLING_PROVIDER,
      useFactory: (): BillingProvider => createBillingProvider(process.env),
    },
    {
      provide: REVENUECAT_PROVIDER,
      useFactory: (): RevenueCatProvider =>
        createRevenueCatProvider(process.env),
    },
  ],
  exports: [BILLING_PROVIDER, AccessService, BillingService],
})
export class BillingModule {}
