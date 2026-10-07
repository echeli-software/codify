import { createHash } from 'node:crypto';

/**
 * Durable quiet-hours deferral (docs/10 §3: "a non-SYSTEM push inside the
 * window is deferred to the window's end"). A delayed BullMQ job carries the
 * already-localised message; `PushDeferredProcessor` hands it back to
 * `PushService.sendToUser` when quiet hours end, where the caps apply.
 */
export const PUSH_DEFERRED_QUEUE = 'push-deferred';
export const PUSH_DEFERRED_JOB = 'push.deliver';

/** docs/10 §3 kinds. Only SYSTEM bypasses quiet hours and caps. */
export type PushKind =
  | 'STREAK_REMINDER'
  | 'DAILY_QUEST'
  | 'FRIEND_NUDGE'
  | 'LEAGUE_RESULT'
  | 'ITEM_DROP'
  | 'PROMO'
  | 'BILLING'
  | 'SYSTEM';

export interface DeferredPushJobData {
  userId: string;
  kind: PushKind | null;
  message: {
    title: string;
    body: string;
    data?: Record<string, string>;
  };
  /** ISO time the job was scheduled for (diagnostics). */
  deliverAt: string;
}

export const PUSH_DEFERRER = Symbol('PUSH_DEFERRER');

export interface PushDeferrer {
  /** Schedule delivery at `deliverAt`; false when the queue is unreachable. */
  defer(job: DeferredPushJobData, deliverAt: Date): Promise<boolean>;
}

/**
 * Stable job id: the same push deferred twice to the same instant collapses
 * onto one job. No `:` (BullMQ rejects custom ids containing one).
 */
export function deferredPushJobId(
  job: DeferredPushJobData,
  deliverAt: Date,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([job.kind, job.message]))
    .digest('hex')
    .slice(0, 16);
  return `push-${job.userId}-${deliverAt.getTime()}-${digest}`;
}
