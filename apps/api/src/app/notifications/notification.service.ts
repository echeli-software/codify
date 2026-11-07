import { Injectable, Logger } from '@nestjs/common';
import type { NotificationKind, Prisma } from '@prisma/client';
import { EmailService, isDeliverableAddress } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EMAIL_KINDS,
  PUSH_KINDS,
  defaultLink,
  resolvePreference,
  safeDeepLink,
  type NotificationAction,
} from './notification-kinds.js';
import {
  PushService,
  type SendToUserOptions,
  type SendToUserResult,
  type UserPushContent,
} from './push.service.js';

/** What a notification says, in the recipient's locale. */
export interface NotifyContent {
  kind: NotificationKind;
  title: string;
  body: string;
  /** App-relative route (`/league`). Defaults per kind. */
  deepLink?: string | null;
  /** Inbox quick action. `undefined` = the kind's default, `null` = none. */
  action?: NotificationAction | null;
  /** Extra push/analytics payload (string values: FCM constraint). */
  data?: Record<string, string>;
  /** Extra lines for the email body (e.g. recap stats). */
  emailLines?: string[];
  /** Per-message channel narrowing (merged under `NotifyOptions.channels`). */
  channels?: { push?: boolean; email?: boolean };
}

export type NotifyContentInput =
  | NotifyContent
  | ((user: { locale: string; displayName: string }) => NotifyContent);

export interface NotifyOptions {
  /**
   * Channels to attempt. Defaults: in-app always; push for PUSH_KINDS;
   * email for EMAIL_KINDS. Preferences, dormancy and caps still apply.
   */
  channels?: { inApp?: boolean; push?: boolean; email?: boolean };
  respectQuietHours?: boolean;
  now?: Date;
}

export type PushOutcome =
  | SendToUserResult
  | { status: 'not_requested' }
  /** Dormant / suspended user: only BILLING (and SYSTEM) reach them. */
  | { status: 'dormant' }
  | { status: 'error' };

export type EmailOutcome =
  | { status: 'sent'; id: string }
  | { status: 'not_requested' }
  | { status: 'disabled' }
  | { status: 'dormant' }
  | { status: 'no_address' }
  | { status: 'error' };

export interface NotifyResult {
  status: 'ok' | 'user_not_found';
  /** The inbox row (IN_APP), when written. */
  inAppId: string | null;
  push: PushOutcome;
  email: EmailOutcome;
}

const NOT_FOUND: NotifyResult = {
  status: 'user_not_found',
  inAppId: null,
  push: { status: 'user_not_found' },
  email: { status: 'not_requested' },
};

/**
 * The one entry point for user notifications (docs/10 §3):
 *   1. always writes the IN_APP row (the inbox is unlimited, user-pull);
 *   2. delivers PUSH through PushService, which owns the delivery rules
 *      and logs the PUSH row (`sentAt`, or `scheduledFor` when deferred
 *      past quiet hours);
 *   3. sends EMAIL for email kinds when the kind's email is on, logging the
 *      EMAIL row.
 * Dormant (90 days lapsed, docs/10 §13) and suspended users only get
 * BILLING (and SYSTEM) push/email. Copy is built per recipient locale.
 * Never throws for delivery failures — the caller's flow must not fail
 * because a notification couldn't go out.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly email: EmailService,
  ) {}

  async notify(
    userId: string,
    content: NotifyContentInput,
    opts: NotifyOptions = {},
  ): Promise<NotifyResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        displayName: true,
        locale: true,
        deletedAt: true,
        suspendedAt: true,
        dormantAt: true,
        notificationPrefs: { select: { kind: true, emailEnabled: true } },
      },
    });
    if (!user || user.deletedAt) return NOT_FOUND;

    const locale = user.locale ?? 'pt-BR';
    const c =
      typeof content === 'function'
        ? content({ locale, displayName: user.displayName })
        : content;
    const kind = c.kind;
    const defaults = defaultLink(kind);
    const deepLink = safeDeepLink(c.deepLink) ?? defaults.deepLink;
    const action = c.action === undefined ? defaults.action : c.action;
    const now = opts.now ?? new Date();
    const channels = { ...(c.channels ?? {}), ...(opts.channels ?? {}) };
    const restricted =
      (!!user.dormantAt || !!user.suspendedAt) &&
      kind !== 'BILLING' &&
      kind !== 'SYSTEM';

    // 1. Inbox.
    let inAppId: string | null = null;
    if (opts.channels?.inApp ?? true) {
      try {
        const row = await this.prisma.notification.create({
          data: {
            userId,
            channel: 'IN_APP',
            kind,
            payload: {
              title: c.title,
              body: c.body,
              deepLink,
              action,
              ...(c.data ? { data: c.data } : {}),
            } as Prisma.InputJsonValue,
            sentAt: now,
          },
          select: { id: true },
        });
        inAppId = row.id;
      } catch (err) {
        this.logger.warn(
          `inbox row for ${userId} (${kind}) failed: ${(err as Error).message}`,
        );
      }
    }

    // 2. Push.
    let push: PushOutcome = { status: 'not_requested' };
    if (channels.push ?? PUSH_KINDS.has(kind)) {
      if (restricted) {
        push = { status: 'dormant' };
      } else {
        try {
          push = await this.push.sendToUser(
            userId,
            {
              kind,
              title: c.title,
              body: c.body,
              data: {
                ...(c.data ?? {}),
                kind,
                url: deepLink,
                ...(inAppId ? { notificationId: inAppId } : {}),
              },
            },
            {
              kind,
              now,
              ...(opts.respectQuietHours === undefined
                ? {}
                : { respectQuietHours: opts.respectQuietHours }),
              logPayload: {
                title: c.title,
                body: c.body,
                deepLink,
                ...(inAppId ? { inAppId } : {}),
              },
            },
          );
        } catch (err) {
          this.logger.warn(
            `push ${kind} to ${userId} failed: ${(err as Error).message}`,
          );
          push = { status: 'error' };
        }
      }
    }

    // 3. Email.
    let email: EmailOutcome = { status: 'not_requested' };
    if (channels.email ?? EMAIL_KINDS.has(kind)) {
      const pref = resolvePreference(
        kind,
        user.notificationPrefs?.find((p) => p.kind === kind),
      );
      if (user.dormantAt && kind !== 'BILLING') email = { status: 'dormant' };
      else if (restricted) email = { status: 'dormant' };
      else if (!pref.emailEnabled) email = { status: 'disabled' };
      else if (!isDeliverableAddress(user.email))
        email = { status: 'no_address' };
      else
        email = await this.sendEmail(
          userId,
          user.email,
          locale,
          c,
          deepLink,
          now,
        );
    }

    return { status: 'ok', inAppId, push, email };
  }

  private async sendEmail(
    userId: string,
    to: string,
    locale: string,
    c: NotifyContent,
    deepLink: string,
    now: Date,
  ): Promise<EmailOutcome> {
    try {
      const sent = await this.email.send({
        userId,
        to,
        locale,
        kind: c.kind,
        title: c.title,
        body: c.body,
        deepLink,
        ...(c.emailLines ? { lines: c.emailLines } : {}),
      });
      try {
        await this.prisma.notification.create({
          data: {
            userId,
            channel: 'EMAIL',
            kind: c.kind,
            payload: {
              subject: c.title,
              body: c.body,
              deepLink,
              providerId: sent.id,
              provider: this.email.mode,
            } as Prisma.InputJsonValue,
            sentAt: now,
          },
        });
      } catch (err) {
        this.logger.warn(`email log failed: ${(err as Error).message}`);
      }
      return { status: 'sent', id: sent.id };
    } catch (err) {
      this.logger.warn(
        `email ${c.kind} to ${userId} failed: ${(err as Error).message}`,
      );
      return { status: 'error' };
    }
  }

  /**
   * PushService-shaped entry point for flows that build push copy
   * (billing): routes the message through `notify` so it lands in the
   * inbox (and email for email kinds) and returns the push outcome.
   * `deepLink` defaults to `data.url` / `data.route`; `channels` on the
   * message narrows push/email.
   */
  async sendToUser(
    userId: string,
    content: UserPushContent,
    opts: SendToUserOptions = {},
  ): Promise<PushOutcome> {
    const res = await this.notify(
      userId,
      (user) => {
        const b = typeof content === 'function' ? content(user) : content;
        const kind = b.kind ?? opts.kind;
        if (!kind)
          throw new Error('NotificationService.sendToUser needs a kind');
        return {
          kind,
          title: b.title,
          body: b.body,
          deepLink: b.deepLink ?? b.data?.['url'] ?? b.data?.['route'] ?? null,
          ...(b.data ? { data: b.data } : {}),
          ...(b.channels ? { channels: b.channels } : {}),
        };
      },
      {
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.respectQuietHours === undefined
          ? {}
          : { respectQuietHours: opts.respectQuietHours }),
      },
    );
    return res.push;
  }
}
