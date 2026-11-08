import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { queueReady, withTimeout } from '../common/queue-options.js';
import { RetryLaterException } from '../common/retry-later.js';
import {
  SUBMISSION_QUEUE,
  type SubmissionJobData,
} from './submission-queue.js';

/**
 * Judge0 backlog throttle (docs/12 §7, docs/14 §7). Every submit is one
 * Judge0 run fed by the `code-submissions` queue, so the queue's waiting
 * count is the backlog in front of Judge0. Above CODE_QUEUE_MAX_BACKLOG
 * new runs/submits get 503 CODE_QUEUE_BUSY + Retry-After instead of piling
 * up behind a sandbox that can't keep up (and timing out anyway).
 */

export const CODE_BACKLOG = Symbol('CODE_BACKLOG');
export const CODE_BACKLOG_POLICY = Symbol('CODE_BACKLOG_POLICY');

export interface CodeBacklog {
  /** Jobs waiting for a Judge0 worker; null when unknown (Redis down). */
  depth(): Promise<number | null>;
}

export interface CodeBacklogPolicy {
  /** Backlog at which new code runs are refused. 0 disables the check. */
  maxBacklog: number;
  /** Jobs processed in parallel (SUBMISSION_WORKER_CONCURRENCY). */
  concurrency: number;
}

export const DEFAULT_MAX_BACKLOG = 100;

export function codeBacklogPolicyFromEnv(
  env: NodeJS.ProcessEnv,
): CodeBacklogPolicy {
  const raw = env['CODE_QUEUE_MAX_BACKLOG']?.trim();
  const max =
    raw === undefined || raw === '' ? DEFAULT_MAX_BACKLOG : Number(raw);
  if (!Number.isInteger(max) || max < 0)
    throw new Error(
      `CODE_QUEUE_MAX_BACKLOG: expected a non-negative integer, got "${raw}"`,
    );
  return {
    maxBacklog: max,
    concurrency: Math.max(1, Number(env['SUBMISSION_WORKER_CONCURRENCY']) || 4),
  };
}

/** Seconds until the backlog has likely drained below the limit (5–60). */
export function backlogRetryAfter(
  depth: number,
  policy: CodeBacklogPolicy,
): number {
  const excess = depth - policy.maxBacklog + 1;
  return Math.min(60, Math.max(5, Math.ceil(excess / policy.concurrency) + 5));
}

@Injectable()
export class BullCodeBacklog implements CodeBacklog {
  constructor(
    @InjectQueue(SUBMISSION_QUEUE)
    private readonly queue: Queue<SubmissionJobData>,
  ) {}

  async depth(): Promise<number | null> {
    if (!(await queueReady(this.queue, 300))) return null;
    return withTimeout(
      this.queue.getWaitingCount().catch(() => null),
      500,
      null,
    );
  }
}

/** Route guard for POST /exercises/:id/run and /submit. */
@Injectable()
export class CodeQueueGuard implements CanActivate {
  private readonly log = new Logger('CodeQueueGuard');

  constructor(
    @Inject(CODE_BACKLOG) private readonly backlog: CodeBacklog,
    @Inject(CODE_BACKLOG_POLICY) private readonly policy: CodeBacklogPolicy,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.policy.maxBacklog <= 0) return true;
    const depth = await this.backlog.depth();
    // Unknown depth: the submit path's own queue fallback handles Redis.
    if (depth === null || depth < this.policy.maxBacklog) return true;
    const retryAfter = backlogRetryAfter(depth, this.policy);
    this.log.warn(
      `Judge0 backlog ${depth} ≥ ${this.policy.maxBacklog} — refusing code run (Retry-After ${retryAfter}s)`,
    );
    // Guards run outside interceptors: set the header here.
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfter));
    throw new RetryLaterException(
      'CODE_QUEUE_BUSY',
      'The code runner is busy; nothing was recorded. Try again shortly.',
      retryAfter,
    );
  }
}
