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

/**
 * BullMQ root options from REDIS_URL. Production without REDIS_URL fails at
 * boot; dev defaults to a local Redis (and the service falls back to inline
 * execution with a warning if it is not running).
 */
export function bullRootOptions(env: NodeJS.ProcessEnv = process.env) {
  const url = env['REDIS_URL']?.trim();
  if (!url && env['NODE_ENV'] === 'production') {
    throw new Error(
      'REDIS_URL is required in production (code submissions run through a BullMQ queue).',
    );
  }
  return {
    prefix: env['BULLMQ_PREFIX']?.trim() || 'codify',
    connection: {
      url: url || 'redis://127.0.0.1:6379',
      // Back off instead of hammering a missing dev Redis.
      retryStrategy: (times: number) => Math.min(times * 500, 10_000),
    },
  };
}
