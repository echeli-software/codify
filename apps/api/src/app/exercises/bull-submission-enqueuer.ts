import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  SUBMISSION_JOB,
  SUBMISSION_QUEUE,
  type SubmissionEnqueuer,
  type SubmissionJobData,
} from './submission-queue.js';

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(fallback), ms).unref?.(),
    ),
  ]);

@Injectable()
export class BullSubmissionEnqueuer implements SubmissionEnqueuer {
  private readonly log = new Logger('SubmissionQueue');

  constructor(
    @InjectQueue(SUBMISSION_QUEUE)
    private readonly queue: Queue<SubmissionJobData>,
  ) {}

  async enqueue(submissionId: string): Promise<boolean> {
    const ready = await withTimeout(
      this.queue.waitUntilReady().then(
        () => true,
        () => false,
      ),
      750,
      false,
    );
    if (!ready) return false;
    try {
      const job = await withTimeout(
        this.queue.add(
          SUBMISSION_JOB,
          { submissionId },
          {
            jobId: submissionId,
            attempts: 1,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        ),
        3000,
        null,
      );
      return job !== null;
    } catch (err) {
      this.log.warn(
        `enqueue failed for ${submissionId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
