import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { queueReady, withTimeout } from '../common/queue-options.js';
import {
  PUSH_DEFERRED_JOB,
  PUSH_DEFERRED_QUEUE,
  deferredPushJobId,
  type DeferredPushJobData,
  type PushDeferrer,
} from './push-deferral.js';

@Injectable()
export class BullPushDeferrer implements PushDeferrer {
  private readonly log = new Logger('PushDeferralQueue');

  constructor(
    @InjectQueue(PUSH_DEFERRED_QUEUE)
    private readonly queue: Queue<DeferredPushJobData>,
  ) {}

  async defer(job: DeferredPushJobData, deliverAt: Date): Promise<boolean> {
    if (!(await queueReady(this.queue))) return false;
    try {
      const added = await withTimeout(
        this.queue.add(PUSH_DEFERRED_JOB, job, {
          jobId: deferredPushJobId(job, deliverAt),
          delay: Math.max(0, deliverAt.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 24 * 3600, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        }),
        3000,
        null,
      );
      return added !== null;
    } catch (err) {
      this.log.warn(
        `deferring push for ${job.userId} failed: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
