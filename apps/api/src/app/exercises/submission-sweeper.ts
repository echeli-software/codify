import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SubmissionsService } from './submissions.service.js';

/** Every 30 s: mark submissions stuck in PENDING/RUNNING as WORKER_LOST. */
@Injectable()
export class SubmissionSweeper {
  constructor(private readonly submissions: SubmissionsService) {}

  @Interval('submission-sweeper', 30_000)
  async sweep(): Promise<void> {
    await this.submissions.sweepStale();
  }
}
