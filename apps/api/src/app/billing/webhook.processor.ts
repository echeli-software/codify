import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  BILLING_WEBHOOK_QUEUE,
  onWebhookJobFailed,
  type StripeEventJobData,
} from './webhook-queue.js';
import { WebhookService } from './webhook.service.js';
import type { WebhookResult } from './webhook-idempotency.js';

/**
 * BullMQ worker for verified Stripe events (docs/09 §6 step 5). Runs the
 * in-transaction claim + process; a throw makes BullMQ retry with
 * exponential backoff, and the final failure is reported to Sentry.
 */
@Processor(BILLING_WEBHOOK_QUEUE, { concurrency: 2 })
export class WebhookProcessor extends WorkerHost {
  private readonly log = new Logger('BillingWebhookWorker');
  private lastErrorLog = 0;

  constructor(private readonly webhooks: WebhookService) {
    super();
  }

  process(job: Job<StripeEventJobData>): Promise<WebhookResult> {
    return this.webhooks.processEvent(job.data.event);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<StripeEventJobData> | undefined, err: Error): void {
    onWebhookJobFailed(job, err, this.log);
  }

  /** Redis connection errors repeat on every retry — log at most once a minute. */
  @OnWorkerEvent('error')
  onError(err: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = now;
    this.log.warn(
      `billing webhook worker error (is REDIS_URL reachable?): ${err.message}`,
    );
  }
}
