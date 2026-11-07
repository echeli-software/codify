import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Notification, NotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  InboxItem,
  InboxPage,
  KindPreferenceView,
  NotificationPreferencesView,
  UpdateNotificationPreferencesDto,
} from './inbox.dto.js';
import {
  EMAIL_KINDS,
  LOCKED_KINDS,
  MAX_FEWER_LEVEL,
  NOTIFICATION_KINDS,
  PUSH_KINDS,
  resolvePreference,
  type NotificationAction,
} from './notification-kinds.js';

const DEFAULT_PAGE = 20;

const LOCKED_ERROR = (kind: NotificationKind) =>
  new BadRequestException({
    code: 'NOTIFICATION_KIND_LOCKED',
    message: `${kind} notifications can't be turned off or reduced`,
  });

/**
 * The student inbox (IN_APP rows, newest first, cursor-paginated) and the
 * notification preferences (docs/05 Settings → Notifications). A user only
 * ever sees or changes their own rows — anything else is a 404.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    cursor?: string,
    limit = DEFAULT_PAGE,
  ): Promise<InboxPage> {
    const take = Math.max(1, Math.min(50, limit));
    // ids are UUIDv7 (time-ordered), so id order is creation order and a
    // stable cursor.
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: take + 1,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map(toInboxItem),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, channel: 'IN_APP', readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<InboxItem> {
    const row = await this.own(userId, id);
    if (row.readAt) return toInboxItem(row);
    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
    });
    return toInboxItem(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, channel: 'IN_APP', readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  /** "Fewer like this": bump the kind's fewerLevel (max 2). */
  async fewer(
    userId: string,
    id: string,
  ): Promise<{ kind: NotificationKind; fewerLevel: number }> {
    const row = await this.own(userId, id);
    if (LOCKED_KINDS.has(row.kind)) throw LOCKED_ERROR(row.kind);
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId_kind: { userId, kind: row.kind } },
    });
    const current = resolvePreference(row.kind, existing);
    const fewerLevel = Math.min(MAX_FEWER_LEVEL, current.fewerLevel + 1);
    await this.prisma.notificationPreference.upsert({
      where: { userId_kind: { userId, kind: row.kind } },
      create: {
        userId,
        kind: row.kind,
        pushEnabled: current.pushEnabled,
        emailEnabled: current.emailEnabled,
        fewerLevel,
      },
      update: { fewerLevel },
    });
    return { kind: row.kind, fewerLevel };
  }

  // ─── Preferences ──────────────────────────────────────────────────────

  async preferences(userId: string): Promise<NotificationPreferencesView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        pushDailyCap: true,
        pushWeeklyOptIn: true,
        reminderMinute: true,
        notificationPrefs: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      pushDailyCap: user.pushDailyCap,
      pushWeeklyOptIn: user.pushWeeklyOptIn,
      reminderMinute: user.reminderMinute,
      kinds: NOTIFICATION_KINDS.map((kind) =>
        kindView(
          kind,
          user.notificationPrefs.find((p) => p.kind === kind),
        ),
      ),
    };
  }

  async updatePreferences(
    userId: string,
    body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesView> {
    const kinds = body.kinds ?? [];
    const seen = new Set<NotificationKind>();
    for (const k of kinds) {
      if (seen.has(k.kind)) {
        throw new BadRequestException({
          code: 'NOTIFICATION_KIND_DUPLICATE',
          message: `${k.kind} appears more than once`,
        });
      }
      seen.add(k.kind);
      if (
        LOCKED_KINDS.has(k.kind) &&
        (k.pushEnabled === false ||
          k.emailEnabled === false ||
          (k.fewerLevel ?? 0) > 0)
      ) {
        throw LOCKED_ERROR(k.kind);
      }
    }

    const userData: Prisma.UserUpdateInput = {};
    if (body.pushDailyCap !== undefined)
      userData.pushDailyCap = body.pushDailyCap;
    if (body.pushWeeklyOptIn !== undefined)
      userData.pushWeeklyOptIn = body.pushWeeklyOptIn;
    if (body.reminderMinute !== undefined)
      userData.reminderMinute = body.reminderMinute;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }
      for (const k of kinds) {
        const existing = await tx.notificationPreference.findUnique({
          where: { userId_kind: { userId, kind: k.kind } },
        });
        const merged = resolvePreference(k.kind, {
          ...(existing ?? {}),
          ...(k.pushEnabled === undefined
            ? {}
            : { pushEnabled: k.pushEnabled }),
          ...(k.emailEnabled === undefined
            ? {}
            : { emailEnabled: k.emailEnabled }),
          ...(k.fewerLevel === undefined ? {} : { fewerLevel: k.fewerLevel }),
        });
        await tx.notificationPreference.upsert({
          where: { userId_kind: { userId, kind: k.kind } },
          create: { userId, kind: k.kind, ...merged },
          update: merged,
        });
      }
    });
    return this.preferences(userId);
  }

  private async own(userId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId, channel: 'IN_APP' },
    });
    if (!row) throw new NotFoundException('Notification not found');
    return row;
  }
}

export function kindView(
  kind: NotificationKind,
  row:
    | { pushEnabled: boolean; emailEnabled: boolean; fewerLevel: number }
    | null
    | undefined,
): KindPreferenceView {
  return {
    kind,
    ...resolvePreference(kind, row),
    locked: LOCKED_KINDS.has(kind),
    channels: { push: PUSH_KINDS.has(kind), email: EMAIL_KINDS.has(kind) },
  };
}

export function toInboxItem(row: Notification): InboxItem {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const action = p['action'] as NotificationAction | null | undefined;
  return {
    id: row.id,
    kind: row.kind,
    title: typeof p['title'] === 'string' ? p['title'] : '',
    body: typeof p['body'] === 'string' ? p['body'] : '',
    deepLink: typeof p['deepLink'] === 'string' ? p['deepLink'] : null,
    action:
      action && typeof action === 'object' && typeof action.type === 'string'
        ? {
            type: action.type,
            ...(typeof action.ref === 'string' ? { ref: action.ref } : {}),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
