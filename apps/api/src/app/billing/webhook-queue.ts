import type { Logger } from '@nestjs/common';
import { reportException } from '../common/sentry.js';
import type { StripeWebhookEvent } from './billing.provider.js';

/**
 * BullMQ hand-off for verified Stripe events (docs/09 §6 steps 4–5): the
 * HTTP request verifies the signature, drops fast duplicates, enqueues and
 * returns 200; `WebhookProcessor` applies the event (in-transaction claim +
 * process) with retries.
 */
export const BILLING_WEBHOOK_QUEUE = 'billing-webhooks';
export const STRIPE_EVENT_JOB = 'stripe.event';

/** docs/09 §6: "after 5 fails, alert". */
export const WEBHOOK_JOB_ATTEMPTS = 5;
/** Exponential backoff base: 5s, 10s, 20s, 40s between the 5 attempts. */
export const WEBHOOK_JOB_BACKOFF_MS = 5_000;

export interface StripeEventJobData {
  event: StripeWebhookEvent;
}

/**
 * Job id for an event, so a redelivered event collapses onto the queued
 * job. BullMQ rejects custom ids containing a single `:` ("Custom Id cannot
 * contain :"), so this is `stripe-<event.id>` — the DB idempotency key stays
 * `stripe:<event.id>`.
 */
export function webhookJobId(eventId: string): string {
  return `stripe-${eventId}`;
}

/** Seam over the queue so the service can be unit-tested and fall back inline. */
export const BILLING_WEBHOOK_ENQUEUER = Symbol('BILLING_WEBHOOK_ENQUEUER');

export interface WebhookEnqueuer {
  /** Enqueue a verified event; resolves false when Redis is unreachable. */
  enqueue(event: StripeWebhookEvent): Promise<boolean>;
}

/** No queue: every event is processed inline (unit tests, scripts). */
export const INLINE_WEBHOOK_ENQUEUER: WebhookEnqueuer = {
  enqueue: async () => false,
};

interface FailedJobLike {
  id?: string;
  attemptsMade: number;
  opts: { attempts?: number };
  data?: Partial<StripeEventJobData>;
}

/**
 * Worker `failed` hook: every failure is logged; the FINAL one (attempts
 * exhausted) is reported to Sentry with the event id/type so someone looks
 * at it — Stripe already got its 200, so nothing else will retry it.
 * Returns true when this was the final attempt.
 */
export function onWebhookJobFailed(
  job: FailedJobLike | undefined,
  err: Error,
  log: Pick<Logger, 'warn' | 'error'>,
): boolean {
  const event = job?.data?.event;
  const label = `${event?.type ?? '?'} ${event?.id ?? job?.id ?? '?'}`;
  const attempts = job?.opts.attempts ?? 1;
  const made = job?.attemptsMade ?? attempts;
  if (made < attempts) {
    log.warn(
      `Stripe webhook ${label} failed (attempt ${made}/${attempts}), will retry: ${err.message}`,
    );
    return false;
  }
  log.error(
    `Stripe webhook ${label} failed permanently after ${made} attempt(s): ${err.message}`,
    err.stack,
  );
  reportException(err, {
    tags: {
      job: 'billing-webhook',
      stripe_event_id: event?.id ?? 'unknown',
      stripe_event_type: event?.type ?? 'unknown',
    },
    extra: { jobId: job?.id, attemptsMade: made },
  });
  return true;
}
