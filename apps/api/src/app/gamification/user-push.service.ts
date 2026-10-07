import { Injectable, Logger } from '@nestjs/common';
import { PushService } from '../notifications/push.service.js';

/** Notification kinds from docs/10-engagement.md §3 that this area sends. */
export type EngagementPushKind =
  | 'FRIEND_NUDGE'
  | 'LEAGUE_RESULT'
  | 'ITEM_DROP'
  | 'SYSTEM';

export interface UserPush {
  kind: EngagementPushKind;
  title: string;
  body: string;
  /** Deep-link/analytics payload; `type` is set from `kind` automatically. */
  data?: Record<string, string>;
}

export interface UserPushResult {
  sent: number;
  /**
   * Why nothing was sent now, when nothing was: `deferred` = queued for the
   * end of quiet hours (will be delivered later); `quiet_hours` = inside
   * quiet hours with no deferral queue (dev without Redis); `capped` = over
   * the per-user push cap (docs/10 §3).
   */
  skipped?: 'deferred' | 'quiet_hours' | 'capped' | 'no_devices' | 'no_user';
}

/**
 * Engagement-area push helper. Delegates to `PushService.sendToUser`, which
 * owns the docs/10 §3 delivery rules (quiet hours with durable deferral to
 * the window's end, ≤ 2 non-SYSTEM pushes per local day ≥ 30 min apart,
 * token pruning). This wrapper only stamps `data.type` from the kind and
 * guarantees a push failure never fails the request/job that triggered it.
 */
@Injectable()
export class UserPushService {
  private readonly logger = new Logger(UserPushService.name);

  constructor(private readonly push: PushService) {}

  async sendToUser(
    userId: string,
    message: UserPush | ((user: { locale: string }) => UserPush),
    now: Date = new Date(),
  ): Promise<UserPushResult> {
    let kind = typeof message === 'function' ? '?' : message.kind;
    try {
      const res = await this.push.sendToUser(
        userId,
        (user) => {
          const msg = typeof message === 'function' ? message(user) : message;
          kind = msg.kind;
          return {
            kind: msg.kind,
            title: msg.title,
            body: msg.body,
            data: { ...(msg.data ?? {}), type: msg.kind.toLowerCase() },
          };
        },
        { now },
      );
      switch (res.status) {
        case 'sent':
          return { sent: res.sent };
        case 'deferred':
          return { sent: 0, skipped: 'deferred' };
        case 'quiet_hours':
          return { sent: 0, skipped: 'quiet_hours' };
        case 'capped':
          return { sent: 0, skipped: 'capped' };
        case 'no_devices':
          return { sent: 0, skipped: 'no_devices' };
        case 'user_not_found':
          return { sent: 0, skipped: 'no_user' };
      }
    } catch (err) {
      // A push failure must never fail the request/job that triggered it.
      this.logger.warn(
        `push ${kind} to ${userId} failed: ${(err as Error).message}`,
      );
      return { sent: 0 };
    }
  }
}
