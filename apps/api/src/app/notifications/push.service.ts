import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { REDIS_CLIENT, type RedisClient } from '../common/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_DAILY_PUSH_CAP,
  FEWER_WINDOWS_MS,
  WEEKLY_PUSH_CAP,
  resolvePreference,
} from './notification-kinds.js';
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
import { recordServerEvent } from './server-analytics.js';
import {
  WEB_PUSH_PROVIDER,
  type WebPushProvider,
  type WebPushTarget,
} from './web-push.provider.js';

export type { PushKind } from './push-deferral.js';

/** A push addressed to a user (fanned out to all their devices). */
export interface UserPushMessage {
  title: string;
  body: string;
  /** Deep-link / analytics payload — string values only (FCM constraint). */
  data?: Record<string, string>;
  /**
   * Hints read by NotificationService (inbox deep link; which channels a
   * kind uses for this message). PushService itself ignores them.
   */
  deepLink?: string;
  channels?: { push?: boolean; email?: boolean };
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
  /** Payload stored on the PUSH delivery-log row (default: the message). */
  logPayload?: Record<string, unknown>;
  /** Existing PUSH log row (a deferred delivery coming back). */
  notificationId?: string;
}

export type CapReason = 'daily' | 'spacing' | 'weekly' | 'fewer';

export type SendToUserResult =
  | { status: 'sent'; sent: number; failed: number; pruned: number }
  /** Inside quiet hours: queued for delivery when they end (ISO time). */
  | { status: 'deferred'; deliverAt: string }
  /** Inside quiet hours and no deferral queue (dev without Redis): nothing
   *  sent. Callers that must deliver re-schedule after `retryAfterMinutes`. */
  | { status: 'quiet_hours'; retryAfterMinutes: number }
  /** Over a cap: the user's daily cap, 30-min spacing, 14/week, or the
   *  kind's "fewer like this" window. Dropped. */
  | { status: 'capped'; reason: CapReason }
  /** The user turned this kind's push off. */
  | { status: 'disabled' }
  | { status: 'no_devices' }
  | { status: 'user_not_found' };

/** `push_skipped` analytics reasons (docs/10 §14). */
export type PushSkipReason =
  | 'quiet_hours'
  | 'no_devices'
  | 'cap'
  | 'disabled'
  | 'fewer';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `User` filter for jobs that pre-select push recipients: a native device
 * token or a browser web push subscription. Spread it into a `where` that
 * has no other top-level `OR`.
 */
export const HAS_PUSH_TARGET = {
  OR: [{ deviceTokens: { some: {} } }, { webPushSubscriptions: { some: {} } }],
} satisfies Prisma.UserWhereInput;

/**
 * The one place push notifications are delivered from (callers go through
 * NotificationService, which also writes the inbox row). Resolves the
 * user's devices and applies the docs/10 §3 delivery rules in the user's
 * timezone:
 *   - per-kind `pushEnabled` (NotificationPreference; PROMO off by default);
 *   - quiet hours → deferred to the window's end on the `push-deferred`
 *     queue (rules re-checked at delivery);
 *   - "fewer like this": level 1 → one push of the kind per 2 days,
 *     level 2 → per 7 days;
 *   - ≤ 14 non-SYSTEM pushes per user-local ISO week unless
 *     `pushWeeklyOptIn`;
 *   - the user's daily cap (`pushDailyCap ?? 2`, 0 = none) and ≥ 30 min
 *     between pushes (Redis).
 * SYSTEM bypasses all of it. Every delivered/deferred push is logged as a
 * PUSH Notification row (`sentAt` / `scheduledFor`); skips emit a
 * server-side `push_skipped` analytics event. Delivery goes through the
 * configured PushProvider (FCM in prod, DevPushProvider locally) and
 * tokens the provider reports as permanently invalid are pruned. Browser
 * web push subscriptions (`WebPushSubscription`, VAPID) are delivered to
 * alongside the native tokens — same message, same rules, one cap slot for
 * the push — and subscriptions the push service answers 404/410 for are
 * deleted.
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
    @Optional()
    @Inject(WEB_PUSH_PROVIDER)
    private readonly webPush: WebPushProvider | null = null,
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
        pushDailyCap: true,
        pushWeeklyOptIn: true,
        deviceTokens: { select: { token: true } },
        webPushSubscriptions: {
          select: { endpoint: true, p256dh: true, auth: true },
        },
        notificationPrefs: {
          select: { kind: true, pushEnabled: true, fewerLevel: true },
        },
      },
    });
    if (!user || user.deletedAt) {
      await this.dropLogRow(opts.notificationId);
      return { status: 'user_not_found' };
    }

    const built =
      typeof content === 'function'
        ? content({ locale: user.locale ?? 'pt-BR' })
        : content;
    const kind = built.kind ?? opts.kind ?? null;
    const message: Omit<PushMessage, 'token'> = {
      title: built.title,
      body: built.body,
      ...(built.data ? { data: built.data } : {}),
    };
    const system = kind === 'SYSTEM';
    const now = opts.now ?? new Date();
    const clock = localClock(now, user.timezone);
    const pref = kind
      ? resolvePreference(
          kind,
          user.notificationPrefs?.find((p) => p.kind === kind),
        )
      : null;

    if (pref && !pref.pushEnabled) {
      return this.skip(userId, kind, 'disabled', opts.notificationId, {
        status: 'disabled',
      });
    }
    // Web subscriptions count only while web push is configured (VAPID).
    const webTargets: WebPushTarget[] = this.webPush?.enabled
      ? (user.webPushSubscriptions ?? [])
      : [];
    if (user.deviceTokens.length === 0 && webTargets.length === 0) {
      return this.skip(userId, kind, 'no_devices', opts.notificationId, {
        status: 'no_devices',
      });
    }

    if (!system && (opts.respectQuietHours ?? true)) {
      const w = quietWindow(user.quietHoursStart, user.quietHoursEnd);
      if (isWithinQuietHours(clock.minutes, w.start, w.end)) {
        const minutes = minutesUntilQuietEnds(clock.minutes, w.start, w.end);
        return this.defer(userId, message, kind, now, minutes, opts);
      }
    }

    let reservation: CapReservation | null = null;
    if (!system) {
      const capped = await this.checkPersistentCaps(
        userId,
        kind,
        pref?.fewerLevel ?? 0,
        user.pushWeeklyOptIn ?? false,
        now,
        clock,
      );
      if (capped) {
        this.logger.log(`push to ${userId} capped (${capped})`);
        return this.skip(
          userId,
          kind,
          capped === 'fewer' ? 'fewer' : 'cap',
          opts.notificationId,
          { status: 'capped', reason: capped },
        );
      }
      const dailyCap = user.pushDailyCap ?? DEFAULT_DAILY_PUSH_CAP;
      const cap =
        dailyCap <= 0
          ? { decision: 'daily' as const, reservation: null }
          : await this.caps.reserve(userId, clock.date, dailyCap);
      if (cap.decision !== 'ok') {
        this.logger.log(`push to ${userId} capped (${cap.decision})`);
        return this.skip(userId, kind, 'cap', opts.notificationId, {
          status: 'capped',
          reason: cap.decision,
        });
      }
      reservation = cap.reservation;
    }

    let result: PushSendResult & { pruned: number };
    try {
      result = await this.deliver(
        user.deviceTokens.map((d) => ({ token: d.token, ...message })),
        { targets: webTargets, content: message },
      );
    } catch (err) {
      await this.caps.release(reservation);
      throw err;
    }
    if (result.sent === 0) {
      // Nothing reached a device: don't burn one of the user's daily slots.
      await this.caps.release(reservation);
      await this.dropLogRow(opts.notificationId);
    } else {
      await this.logSent(userId, kind, message, now, opts);
      await recordServerEvent(
        this.prisma,
        userId,
        'push_sent',
        { kind: kind ?? 'unknown', devices: result.sent },
        now,
      );
    }
    return {
      status: 'sent',
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    };
  }

  /**
   * The DB-backed caps: "fewer like this" (last push of the kind inside
   * its window) and the 14/week guarantee. Counted from the PUSH delivery
   * log, so they survive Redis restarts.
   */
  private async checkPersistentCaps(
    userId: string,
    kind: PushKind | null,
    fewerLevel: number,
    weeklyOptIn: boolean,
    now: Date,
    clock: { date: string; minutes: number },
  ): Promise<'fewer' | 'weekly' | null> {
    const window = FEWER_WINDOWS_MS[fewerLevel];
    if (kind && window) {
      const recent = await this.prisma.notification.findFirst({
        where: {
          userId,
          kind,
          channel: 'PUSH',
          sentAt: { gte: new Date(now.getTime() - window) },
        },
        select: { id: true },
      });
      if (recent) return 'fewer';
    }
    if (!weeklyOptIn) {
      const sentThisWeek = await this.prisma.notification.count({
        where: {
          userId,
          channel: 'PUSH',
          kind: { not: 'SYSTEM' },
          sentAt: { gte: localWeekStart(now, clock) },
        },
      });
      if (sentThisWeek >= WEEKLY_PUSH_CAP) return 'weekly';
    }
    return null;
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
    message: Omit<PushMessage, 'token'>,
    kind: PushKind | null,
    now: Date,
    minutes: number,
    opts: SendToUserOptions,
  ): Promise<SendToUserResult> {
    const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000;
    const deliverAt = new Date(minuteStart + minutes * 60_000);
    const notificationId = this.deferrer
      ? await this.logScheduled(userId, kind, message, deliverAt, opts)
      : undefined;
    const queued = this.deferrer
      ? await this.deferrer.defer(
          {
            userId,
            kind,
            message,
            deliverAt: deliverAt.toISOString(),
            ...(notificationId ? { notificationId } : {}),
          },
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
    return this.skip(userId, kind, 'quiet_hours', notificationId, {
      status: 'quiet_hours',
      retryAfterMinutes: minutes,
    });
  }

  private async skip<T extends SendToUserResult>(
    userId: string,
    kind: PushKind | null,
    reason: PushSkipReason,
    notificationId: string | undefined,
    result: T,
  ): Promise<T> {
    await this.dropLogRow(notificationId);
    await recordServerEvent(this.prisma, userId, 'push_skipped', {
      kind: kind ?? 'unknown',
      reason,
    });
    return result;
  }

  // ─── PUSH delivery log (Notification rows, channel PUSH) ──────────────

  private payloadFor(
    message: Omit<PushMessage, 'token'>,
    opts: SendToUserOptions,
  ): Prisma.InputJsonValue {
    return (opts.logPayload ?? {
      title: message.title,
      body: message.body,
      ...(message.data ? { data: message.data } : {}),
    }) as Prisma.InputJsonValue;
  }

  private async logScheduled(
    userId: string,
    kind: PushKind | null,
    message: Omit<PushMessage, 'token'>,
    deliverAt: Date,
    opts: SendToUserOptions,
  ): Promise<string | undefined> {
    if (!kind) return undefined;
    try {
      if (opts.notificationId) {
        await this.prisma.notification.update({
          where: { id: opts.notificationId },
          data: { scheduledFor: deliverAt },
        });
        return opts.notificationId;
      }
      const row = await this.prisma.notification.create({
        data: {
          userId,
          channel: 'PUSH',
          kind,
          payload: this.payloadFor(message, opts),
          scheduledFor: deliverAt,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.logger.warn(
        `push log (scheduled) failed: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async logSent(
    userId: string,
    kind: PushKind | null,
    message: Omit<PushMessage, 'token'>,
    now: Date,
    opts: SendToUserOptions,
  ): Promise<void> {
    if (!kind) return;
    try {
      if (opts.notificationId) {
        const res = await this.prisma.notification.updateMany({
          where: { id: opts.notificationId, userId, channel: 'PUSH' },
          data: { sentAt: now },
        });
        if (res.count > 0) return;
      }
      await this.prisma.notification.create({
        data: {
          userId,
          channel: 'PUSH',
          kind,
          payload: this.payloadFor(message, opts),
          sentAt: now,
        },
      });
    } catch (err) {
      this.logger.warn(`push log (sent) failed: ${(err as Error).message}`);
    }
  }

  /** A deferred push that ended up not delivered leaves no log row. */
  private async dropLogRow(id: string | undefined): Promise<void> {
    if (!id) return;
    try {
      await this.prisma.notification.deleteMany({
        where: { id, channel: 'PUSH', sentAt: null },
      });
    } catch (err) {
      this.logger.warn(`push log cleanup failed: ${(err as Error).message}`);
    }
  }

  /**
   * Send a batch and prune invalid tokens / expired web subscriptions.
   * Shared with batch jobs. `web.targets` (browser subscriptions) get
   * `web.content` as a web push when web push is configured.
   */
  async deliver(
    messages: PushMessage[],
    web?: {
      targets: readonly WebPushTarget[];
      content: Omit<PushMessage, 'token'>;
    },
  ): Promise<PushSendResult & { pruned: number }> {
    const native =
      messages.length === 0
        ? { sent: 0, failed: 0, invalidTokens: [] as string[] }
        : await this.provider.send(messages);
    let pruned = await this.prune(native.invalidTokens);
    let sent = native.sent;
    let failed = native.failed;
    if (web && web.targets.length > 0 && this.webPush?.enabled) {
      const w = await this.webPush.send(web.targets, {
        title: web.content.title,
        body: web.content.body,
        ...(web.content.data ? { data: web.content.data } : {}),
      });
      sent += w.sent;
      failed += w.failed;
      pruned += await this.pruneWeb(w.expiredEndpoints);
    }
    return { sent, failed, invalidTokens: native.invalidTokens, pruned };
  }

  /** Delete web push subscriptions the push service reported gone. */
  async pruneWeb(endpoints: readonly string[]): Promise<number> {
    if (endpoints.length === 0) return 0;
    const { count } = await this.prisma.webPushSubscription.deleteMany({
      where: { endpoint: { in: [...endpoints] } },
    });
    if (count)
      this.logger.log(`Pruned ${count} expired web push subscription(s)`);
    return count;
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

/**
 * Start of the user-local ISO week (Monday 00:00) as an instant. Derived
 * from the local clock, so a DST change inside the week shifts it by at
 * most an hour — fine for a weekly cap.
 */
export function localWeekStart(
  now: Date,
  clock: { date: string; minutes: number },
): Date {
  const weekday = new Date(`${clock.date}T00:00:00Z`).getUTCDay(); // 0 = Sun
  const sinceMonday = (weekday + 6) % 7;
  const msIntoMinute = now.getTime() % 60_000;
  return new Date(
    now.getTime() -
      msIntoMinute -
      clock.minutes * 60_000 -
      sinceMonday * DAY_MS,
  );
}
