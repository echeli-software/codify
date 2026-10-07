import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PUSH_PROVIDER,
  type PushMessage,
  type PushProvider,
} from '../notifications/push.provider.js';

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
  /** Why nothing was sent, when nothing was. */
  skipped?: 'quiet_hours' | 'no_devices' | 'no_user';
}

/** Default quiet hours, user-local minutes from midnight (22:00–08:00). */
export const DEFAULT_QUIET_START = 22 * 60;
export const DEFAULT_QUIET_END = 8 * 60;

/** Minutes since local midnight of `at` in `timeZone` (UTC on a bad zone). */
export function localMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

/**
 * True when `minutes` (local) falls in the [start, end) quiet window, which
 * may wrap midnight. start === end means "no quiet hours".
 */
export function inQuietHours(
  minutes: number,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  const s = start ?? DEFAULT_QUIET_START;
  const e = end ?? DEFAULT_QUIET_END;
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/**
 * Engagement-area push helper: resolves a user's DeviceTokens, honours
 * quiet hours (docs/10 §3 — everything but SYSTEM), sends via the shared
 * PUSH_PROVIDER, and prunes tokens the provider reports invalid.
 *
 * Interim: the Platform area is adding `PushService.sendToUser` (with quiet
 * hours, per-day caps and deferral to the window's end). When it lands,
 * replace the body of {@link sendToUser} with a single delegating call —
 * every caller in this area already goes through this method. Until then a
 * push inside quiet hours is dropped (reported as `skipped: 'quiet_hours'`)
 * rather than deferred, because there is no delayed-delivery queue yet.
 */
@Injectable()
export class UserPushService {
  private readonly logger = new Logger(UserPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async sendToUser(
    userId: string,
    message: UserPush | ((user: { locale: string }) => UserPush),
    now: Date = new Date(),
  ): Promise<UserPushResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        locale: true,
        timezone: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        deletedAt: true,
        deviceTokens: { select: { token: true } },
      },
    });
    if (!user || user.deletedAt) return { sent: 0, skipped: 'no_user' };
    if (user.deviceTokens.length === 0)
      return { sent: 0, skipped: 'no_devices' };
    const msg = typeof message === 'function' ? message(user) : message;
    if (
      msg.kind !== 'SYSTEM' &&
      inQuietHours(
        localMinutes(now, user.timezone || 'America/Sao_Paulo'),
        user.quietHoursStart,
        user.quietHoursEnd,
      )
    ) {
      return { sent: 0, skipped: 'quiet_hours' };
    }

    const messages: PushMessage[] = user.deviceTokens.map((d) => ({
      token: d.token,
      title: msg.title,
      body: msg.body,
      data: { ...(msg.data ?? {}), type: msg.kind.toLowerCase() },
    }));
    try {
      const res = await this.push.send(messages);
      if (res.invalidTokens.length) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: res.invalidTokens } },
        });
      }
      return { sent: res.sent };
    } catch (err) {
      // A push failure must never fail the request/job that triggered it.
      this.logger.warn(
        `push ${msg.kind} to ${userId} failed: ${(err as Error).message}`,
      );
      return { sent: 0 };
    }
  }
}
