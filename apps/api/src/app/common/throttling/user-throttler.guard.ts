import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { throttleEnabled } from '../../config/env.js';
import { userOrIpTracker } from './trackers.js';

/**
 * Global throttler guard (APP_GUARD):
 *  - tracker = authenticated user id, else client IP (AuthMiddleware has
 *    already populated `req.user` when the guard runs);
 *  - buckets are keyed per throttler + tracker, NOT per route, so "60/min
 *    per user" means across the whole API and the reward/ai/code groups
 *    share one bucket per user across all their routes;
 *  - a plain `Retry-After` header (seconds) on every 429 — the library
 *    only sets `Retry-After-<name>` for non-default throttlers;
 *  - THROTTLE_ENABLED=false (dev only) turns it off for seed/probe scripts.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(): Promise<boolean> {
    return !throttleEnabled();
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    return userOrIpTracker(req as Parameters<typeof userOrIpTracker>[0]);
  }

  protected override generateKey(
    _ctx: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    return `throttle:${throttlerName}:${tracker}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const retryAfter = Math.max(
      1,
      Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 1),
    );
    this.setResponseHeader(res, 'Retry-After', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
