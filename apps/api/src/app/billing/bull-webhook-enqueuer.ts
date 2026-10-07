import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { queueReady, withTimeout } from '../common/queue-options.js';
import type { StripeWebhookEvent } from './billing.provider.js';
import {
  BILLING_WEBHOOK_QUEUE,
  STRIPE_EVENT_JOB,
  WEBHOOK_JOB_ATTEMPTS,
  WEBHOOK_JOB_BACKOFF_MS,
  webhookJobId,
  type StripeEventJobData,
  type WebhookEnqueuer,
} from './webhook-queue.js';

@Injectable()
export class BullWebhookEnqueuer implements WebhookEnqueuer {
  private readonly log = new Logger('BillingWebhookQueue');

  constructor(
    @InjectQueue(BILLING_WEBHOOK_QUEUE)
    private readonly queue: Queue<StripeEventJobData>,
  ) {}

  async enqueue(event: StripeWebhookEvent): Promise<boolean> {
    if (!(await queueReady(this.queue))) return false;
    try {
      const job = await withTimeout(
        this.queue.add(
          STRIPE_EVENT_JOB,
          { event },
          {
            jobId: webhookJobId(event.id),
            attempts: WEBHOOK_JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: WEBHOOK_JOB_BACKOFF_MS },
            removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
            removeOnFail: { age: 30 * 24 * 3600 },
          },
        ),
        3000,
        null,
      );
      return job !== null;
    } catch (err) {
      this.log.warn(
        `enqueue failed for Stripe event ${event.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
