import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PUSH_PROVIDER,
  type PushMessage,
  type PushProvider,
  type PushSendResult,
} from './push.provider.js';
import {
  isWithinQuietHours,
  localClock,
  minutesUntilQuietEnds,
  quietWindow,
} from './quiet-hours.js';

/** A push addressed to a user (fanned out to all their devices). */
export interface UserPushMessage {
  title: string;
  body: string;
  /** Deep-link / analytics payload — string values only (FCM constraint). */
  data?: Record<string, string>;
}

export interface SendToUserOptions {
  /**
   * Skip delivery while the user is inside their quiet hours (default true).
   * Pass false only for SYSTEM-kind pushes (docs/10 §3).
   */
  respectQuietHours?: boolean;
  /** Clock override for tests. */
  now?: Date;
}

export type SendToUserResult =
  | { status: 'sent'; sent: number; failed: number; pruned: number }
  /** Inside quiet hours: nothing sent. Callers that must deliver later
   *  re-schedule after `retryAfterMinutes` (no durable queue here yet). */
  | { status: 'quiet_hours'; retryAfterMinutes: number }
  | { status: 'no_devices' }
  | { status: 'user_not_found' };

/**
 * The one place other modules send push notifications from. Resolves the
 * user's devices, enforces quiet hours in the user's timezone, delivers via
 * the configured PushProvider (FCM in prod, DevPushProvider locally) and
 * prunes tokens the provider reports as permanently invalid.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async sendToUser(
    userId: string,
    message: UserPushMessage,
    opts: SendToUserOptions = {},
  ): Promise<SendToUserResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        timezone: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        deletedAt: true,
        deviceTokens: { select: { token: true } },
      },
    });
    if (!user || user.deletedAt) return { status: 'user_not_found' };

    if (opts.respectQuietHours ?? true) {
      const clock = localClock(opts.now ?? new Date(), user.timezone);
      const w = quietWindow(user.quietHoursStart, user.quietHoursEnd);
      if (isWithinQuietHours(clock.minutes, w.start, w.end)) {
        return {
          status: 'quiet_hours',
          retryAfterMinutes: minutesUntilQuietEnds(
            clock.minutes,
            w.start,
            w.end,
          ),
        };
      }
    }

    if (user.deviceTokens.length === 0) return { status: 'no_devices' };

    const result = await this.deliver(
      user.deviceTokens.map((d) => ({ token: d.token, ...message })),
    );
    return {
      status: 'sent',
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    };
  }

  /** Send a batch and prune invalid tokens. Shared with batch jobs. */
  async deliver(
    messages: PushMessage[],
  ): Promise<PushSendResult & { pruned: number }> {
    if (messages.length === 0)
      return { sent: 0, failed: 0, invalidTokens: [], pruned: 0 };
    const result = await this.provider.send(messages);
    const pruned = await this.prune(result.invalidTokens);
    return { ...result, pruned };
  }

  async prune(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { token: { in: tokens } },
    });
    if (count) this.logger.log(`Pruned ${count} invalid push token(s)`);
    return count;
  }
}
