import { Injectable, Logger } from '@nestjs/common';
import type { NotificationAction } from '../notifications/notification-kinds.js';
import { NotificationService } from '../notifications/notification.service.js';

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
  /**
   * Deep-link/analytics payload; `type` is set from `kind` automatically.
   * `route` becomes the inbox deep link, `senderId` (FRIEND_NUDGE) the
   * "send back a nudge" quick action.
   */
  data?: Record<string, string>;
}

export interface UserPushResult {
  sent: number;
  /**
   * Why no push went out now, when none did: `deferred` = queued for the
   * end of quiet hours (will be delivered later); `quiet_hours` = inside
   * quiet hours with no deferral queue (dev without Redis); `capped` = over
   * a push cap (docs/10 §3); `disabled` = the user turned this kind off;
   * `dormant` = 90-day dormant user (docs/10 §13).
   */
  skipped?:
    | 'deferred'
    | 'quiet_hours'
    | 'capped'
    | 'disabled'
    | 'dormant'
    | 'no_devices'
    | 'no_user';
}

/**
 * Engagement-area notification helper. Delegates to
 * `NotificationService.notify`, so every message lands in the user's inbox
 * and the push goes through PushService's docs/10 §3 delivery rules
 * (per-kind toggles, quiet hours with durable deferral, daily / weekly /
 * "fewer like this" caps, ≥ 30 min spacing, token pruning). This wrapper
 * stamps `data.type` from the kind, maps `data.route` / `data.senderId` to
 * the inbox deep link / quick action, and guarantees a failure never fails
 * the request/job that triggered it.
 */
@Injectable()
export class UserPushService {
  private readonly logger = new Logger(UserPushService.name);

  constructor(private readonly notifications: NotificationService) {}

  async sendToUser(
    userId: string,
    message: UserPush | ((user: { locale: string }) => UserPush),
    now: Date = new Date(),
  ): Promise<UserPushResult> {
    let kind = typeof message === 'function' ? '?' : message.kind;
    try {
      const res = await this.notifications.notify(
        userId,
        (user) => {
          const msg = typeof message === 'function' ? message(user) : message;
          kind = msg.kind;
          return {
            kind: msg.kind,
            title: msg.title,
            body: msg.body,
            deepLink: msg.data?.['route'] ?? null,
            ...(quickAction(msg) ? { action: quickAction(msg) } : {}),
            data: { ...(msg.data ?? {}), type: msg.kind.toLowerCase() },
          };
        },
        { now },
      );
      if (res.status === 'user_not_found')
        return { sent: 0, skipped: 'no_user' };
      switch (res.push.status) {
        case 'sent':
          return { sent: res.push.sent };
        case 'deferred':
          return { sent: 0, skipped: 'deferred' };
        case 'quiet_hours':
          return { sent: 0, skipped: 'quiet_hours' };
        case 'capped':
          return { sent: 0, skipped: 'capped' };
        case 'disabled':
          return { sent: 0, skipped: 'disabled' };
        case 'dormant':
          return { sent: 0, skipped: 'dormant' };
        case 'no_devices':
          return { sent: 0, skipped: 'no_devices' };
        case 'user_not_found':
          return { sent: 0, skipped: 'no_user' };
        case 'not_requested':
        case 'error':
          return { sent: 0 };
      }
    } catch (err) {
      // A notification failure must never fail the request/job that triggered it.
      this.logger.warn(
        `notification ${kind} to ${userId} failed: ${(err as Error).message}`,
      );
      return { sent: 0 };
    }
  }
}

/** FRIEND_NUDGE carries the sender → "send back a nudge". */
function quickAction(msg: UserPush): NotificationAction | undefined {
  if (msg.kind === 'FRIEND_NUDGE' && msg.data?.['senderId']) {
    return { type: 'nudge_back', ref: msg.data['senderId'] };
  }
  return undefined;
}
