/** BullMQ queue carrying `submission.run` jobs (docs/12 §1, §6). */
export const SUBMISSION_QUEUE = 'code-submissions';
export const SUBMISSION_JOB = 'submission.run';

export interface SubmissionJobData {
  submissionId: string;
}

/** Seam over the queue so the service can be unit-tested and fall back inline. */
export const SUBMISSION_ENQUEUER = Symbol('SUBMISSION_ENQUEUER');

export interface SubmissionEnqueuer {
  /** Enqueue a job; resolves false when the queue (Redis) is unreachable. */
  enqueue(submissionId: string): Promise<boolean>;
}
