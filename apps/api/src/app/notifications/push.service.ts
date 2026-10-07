import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CLIENT, type RedisClient } from '../common/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushCapStore, type CapReservation } from './push-caps.js';
import {
  PUSH_DEFERRER,
  type PushDeferrer,
  type PushKind,
} from './push-deferral.js';
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

export type { PushKind } from './push-deferral.js';

/** A push addressed to a user (fanned out to all their devices). */
export interface UserPushMessage {
  title: string;
  body: string;
  /** Deep-link / analytics payload — string values only (FCM constraint). */
  data?: Record<string, string>;
}

/**
 * A message, or a builder that picks copy by the user's locale. A `kind` on
 * the built message overrides `SendToUserOptions.kind`.
 */
export type UserPushContent =
  | (UserPushMessage & { kind?: PushKind })
  | ((user: { locale: string }) => UserPushMessage & { kind?: PushKind });

export interface SendToUserOptions {
  /**
   * docs/10 §3 kind. `SYSTEM` bypasses quiet hours AND the per-user caps;
   * every other kind (or none) is subject to both.
   */
  kind?: PushKind;
  /**
   * Honour the user's quiet hours (default true). `false` skips the quiet
   * window only — caps still apply unless `kind` is `SYSTEM`.
   */
  respectQuietHours?: boolean;
  /** Clock override for tests. */
  now?: Date;
}

export type SendToUserResult =
  | { status: 'sent'; sent: number; failed: number; pruned: number }
  /** Inside quiet hours: queued for delivery when they end (ISO time). */
  | { status: 'deferred'; deliverAt: string }
  /** Inside quiet hours and no deferral queue (dev without Redis): nothing
   *  sent. Callers that must deliver re-schedule after `retryAfterMinutes`. */
  | { status: 'quiet_hours'; retryAfterMinutes: number }
  /** Over the per-user cap (2/local day, 30 min apart): dropped. */
  | { status: 'capped'; reason: 'daily' | 'spacing' }
  | { status: 'no_devices' }
  | { status: 'user_not_found' };

/**
 * The one place other modules send push notifications from. Resolves the
 * user's devices, applies the docs/10 §3 delivery rules in the user's
 * timezone — quiet hours (deferred to the window's end on the
 * `push-deferred` queue) and caps (≤ 2 non-SYSTEM pushes per local day,
 * ≥ 30 min apart, tracked in Redis) — delivers via the configured
 * PushProvider (FCM in prod, DevPushProvider locally) and prunes tokens the
 * provider reports as permanently invalid.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly caps: PushCapStore;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    @Optional()
    @Inject(PUSH_DEFERRER)
    private readonly deferrer: PushDeferrer | null = null,
    @Optional() @Inject(REDIS_CLIENT) redis: RedisClient = null,
  ) {
    this.caps = new PushCapStore(redis);
  }

  async sendToUser(
    userId: string,
    content: UserPushContent,
    opts: SendToUserOptions = {},
  ): Promise<SendToUserResult> {
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
    if (!user || user.deletedAt) return { status: 'user_not_found' };
    if (user.deviceTokens.length === 0) return { status: 'no_devices' };

    const built =
      typeof content === 'function'
        ? content({ locale: user.locale ?? 'pt-BR' })
        : content;
    const kind = built.kind ?? opts.kind;
    const message: UserPushMessage = {
      title: built.title,
      body: built.body,
      ...(built.data ? { data: built.data } : {}),
    };
    const system = kind === 'SYSTEM';
    const now = opts.now ?? new Date();
    const clock = localClock(now, user.timezone);

    if (!system && (opts.respectQuietHours ?? true)) {
      const w = quietWindow(user.quietHoursStart, user.quietHoursEnd);
      if (isWithinQuietHours(clock.minutes, w.start, w.end)) {
        const minutes = minutesUntilQuietEnds(clock.minutes, w.start, w.end);
        return this.defer(userId, message, kind ?? null, now, minutes);
      }
    }

    let reservation: CapReservation | null = null;
    if (!system) {
      const cap = await this.caps.reserve(userId, clock.date);
      if (cap.decision !== 'ok') {
        this.logger.log(`push to ${userId} capped (${cap.decision})`);
        return { status: 'capped', reason: cap.decision };
      }
      reservation = cap.reservation;
    }

    let result: PushSendResult & { pruned: number };
    try {
      result = await this.deliver(
        user.deviceTokens.map((d) => ({ token: d.token, ...message })),
      );
    } catch (err) {
      await this.caps.release(reservation);
      throw err;
    }
    // Nothing reached a device: don't burn one of the user's daily slots.
    if (result.sent === 0) await this.caps.release(reservation);
    return {
      status: 'sent',
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    };
  }

  /**
   * Reserve a cap slot for a push sent outside `sendToUser` (batch jobs that
   * call `deliver` directly). False = over the cap; skip this user.
   */
  async tryReserveCap(
    userId: string,
    timezone: string | null | undefined,
    now: Date = new Date(),
  ): Promise<boolean> {
    const { decision } = await this.caps.reserve(
      userId,
      localClock(now, timezone).date,
    );
    return decision === 'ok';
  }

  /** Queue the push for the end of quiet hours (or report quiet_hours). */
  private async defer(
    userId: string,
    message: UserPushMessage,
    kind: PushKind | null,
    now: Date,
    minutes: number,
  ): Promise<SendToUserResult> {
    const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000;
    const deliverAt = new Date(minuteStart + minutes * 60_000);
    const queued = this.deferrer
      ? await this.deferrer.defer(
          { userId, kind, message, deliverAt: deliverAt.toISOString() },
          deliverAt,
        )
      : false;
    if (queued)
      return { status: 'deferred', deliverAt: deliverAt.toISOString() };
    if (this.deferrer) {
      this.logger.warn(
        `push deferral queue unreachable (REDIS_URL) — push to ${userId} dropped for quiet hours`,
      );
    }
    return { status: 'quiet_hours', retryAfterMinutes: minutes };
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
