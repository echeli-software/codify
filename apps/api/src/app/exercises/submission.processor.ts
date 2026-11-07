import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  SUBMISSION_QUEUE,
  type SubmissionJobData,
} from './submission-queue.js';
import { SubmissionsService } from './submissions.service.js';

const concurrency = Math.max(
  1,
  Number(process.env['SUBMISSION_WORKER_CONCURRENCY']) || 4,
);

/** BullMQ worker for `submission.run` jobs (docs/12 §6 step 5). */
@Processor(SUBMISSION_QUEUE, { concurrency })
export class SubmissionProcessor extends WorkerHost {
  private readonly log = new Logger('SubmissionWorker');
  private lastErrorLog = 0;

  constructor(private readonly submissions: SubmissionsService) {
    super();
  }

  async process(job: Job<SubmissionJobData>): Promise<void> {
    await this.submissions.process(job.data.submissionId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SubmissionJobData> | undefined, err: Error): void {
    this.log.error(`job ${job?.id ?? '?'} failed: ${err.message}`);
  }

  /** Redis connection errors repeat on every retry — log at most once a minute. */
  @OnWorkerEvent('error')
  onError(err: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = now;
    this.log.warn(
      `queue worker error (is REDIS_URL reachable?): ${err.message}`,
    );
  }
}
