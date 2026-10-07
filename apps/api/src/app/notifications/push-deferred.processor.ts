import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  PUSH_DEFERRED_QUEUE,
  type DeferredPushJobData,
} from './push-deferral.js';
import { PushService, type SendToUserResult } from './push.service.js';

/**
 * Delivers pushes deferred past quiet hours. Goes back through
 * `sendToUser`, so caps apply at delivery time (an over-cap push is
 * dropped as `capped`) and a user who moved their quiet hours meanwhile is
 * deferred again rather than woken up.
 */
@Processor(PUSH_DEFERRED_QUEUE, { concurrency: 4 })
export class PushDeferredProcessor extends WorkerHost {
  private readonly log = new Logger('PushDeferredWorker');
  private lastErrorLog = 0;

  constructor(private readonly push: PushService) {
    super();
  }

  async process(job: Job<DeferredPushJobData>): Promise<SendToUserResult> {
    const { userId, kind, message } = job.data;
    const res = await this.push.sendToUser(userId, message, {
      kind: kind ?? undefined,
    });
    if (res.status !== 'sent') {
      this.log.log(`deferred push for ${userId} → ${res.status}`);
    }
    return res;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DeferredPushJobData> | undefined, err: Error): void {
    this.log.warn(`deferred push ${job?.id ?? '?'} failed: ${err.message}`);
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = now;
    this.log.warn(
      `push deferral worker error (is REDIS_URL reachable?): ${err.message}`,
    );
  }
}
