import { Injectable, Logger } from '@nestjs/common';
import { dailyQuestReminderCopy } from '../email/copy.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  isWithinQuietHours,
  localClock,
  quietWindow,
} from '../notifications/quiet-hours.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { claimOnce } from './claims.js';
import {
  SESSION_START_EVENTS,
  reminderMinuteFor,
  typicalSessionStart,
} from './session-time.js';

const SCOPE = 'daily_quest_reminder';
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Only recently active users get reminders (lapsed users: §13 instead). */
const ACTIVE_DAYS = 7;
/** Session-start history considered for the learned time. */
const HISTORY_DAYS = 28;
/** A run catches up on reminders that became due within this window. */
export const REMINDER_WINDOW_MIN = 60;

export interface DailyQuestReminderResult {
  candidates: number;
  notified: number;
  pushed: number;
  completedToday: number;
  notDue: number;
  quietHours: number;
  alreadyReminded: number;
}

export interface DailyQuestReminderOptions {
  /** `manual` ignores the due window (verification aid). */
  mode?: 'scheduled' | 'manual';
  now?: Date;
}

/**
 * DAILY_QUEST reminders (docs/10 §3): users active in the last week who
 * have not completed a lesson today get one reminder at their
 * `reminderMinute`, else 30 min after their typical session start (once 7
 * days of `app_opened` / `session_start` data exist), else 20:00
 * user-local. Skipped inside quiet hours (never deferred into tomorrow)
 * and for users who turned DAILY_QUEST push off; caps apply in
 * PushService. Idempotent per user per local day; runs every 15 min.
 */
@Injectable()
export class DailyQuestReminderService {
  private readonly logger = new Logger(DailyQuestReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(
    opts: DailyQuestReminderOptions = {},
  ): Promise<DailyQuestReminderResult> {
    const now = opts.now ?? new Date();
    const manual = opts.mode === 'manual';
    const out: DailyQuestReminderResult = {
      candidates: 0,
      notified: 0,
      pushed: 0,
      completedToday: 0,
      notDue: 0,
      quietHours: 0,
      alreadyReminded: 0,
    };
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          role: 'STUDENT',
          deletedAt: null,
          dormantAt: null,
          suspendedAt: null,
          lastSeenAt: { gte: new Date(now.getTime() - ACTIVE_DAYS * DAY_MS) },
          deviceTokens: { some: {} },
          notificationPrefs: {
            none: { kind: 'DAILY_QUEST', pushEnabled: false },
          },
        },
        select: {
          id: true,
          timezone: true,
          reminderMinute: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          streak: { select: { lastActivityDate: true } },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (users.length === 0) break;

      const opens = await this.sessionStarts(
        users.filter((u) => u.reminderMinute === null).map((u) => u.id),
        now,
      );
      for (const u of users) {
        out.candidates += 1;
        const today = localClock(now, u.timezone);
        // Streak.lastActivityDate is the user-local date at UTC midnight.
        const last = u.streak?.lastActivityDate.toISOString().slice(0, 10);
        if (last && last >= today.date) {
          out.completedToday += 1;
          continue;
        }
        const due = reminderMinuteFor(
          u.reminderMinute,
          u.reminderMinute === null
            ? typicalSessionStart(opens.get(u.id) ?? [], u.timezone)
            : null,
        ).minute;
        if (!manual && !isDue(today.minutes, due)) {
          out.notDue += 1;
          continue;
        }
        const w = quietWindow(u.quietHoursStart, u.quietHoursEnd);
        if (isWithinQuietHours(today.minutes, w.start, w.end)) {
          out.quietHours += 1;
          continue;
        }
        if (
          !(await claimOnce(this.prisma, SCOPE, `${u.id}:${today.date}`, u.id))
        ) {
          out.alreadyReminded += 1;
          continue;
        }
        const res = await this.notifications.notify(
          u.id,
          ({ locale }) => ({
            kind: 'DAILY_QUEST',
            ...dailyQuestReminderCopy(locale),
            deepLink: '/today',
            data: { type: 'daily_quest_reminder' },
          }),
          { now },
        );
        out.notified += 1;
        if (res.push.status === 'sent') out.pushed += 1;
      }
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) break;
    }
    if (out.notified > 0 || manual) {
      this.logger.log(
        `daily quest reminders: ${out.notified} notified (${out.pushed} pushed) of ${out.candidates} candidates`,
      );
    }
    return out;
  }

  /** Session-start timestamps per user (last 28 days). */
  private async sessionStarts(
    userIds: string[],
    now: Date,
  ): Promise<Map<string, Date[]>> {
    const map = new Map<string, Date[]>();
    if (userIds.length === 0) return map;
    const rows = await this.prisma.analyticsEvent.findMany({
      where: {
        userId: { in: userIds },
        name: { in: [...SESSION_START_EVENTS] },
        occurredAt: { gte: new Date(now.getTime() - HISTORY_DAYS * DAY_MS) },
      },
      select: { userId: true, occurredAt: true },
    });
    for (const r of rows) {
      if (!r.userId) continue;
      const list = map.get(r.userId) ?? [];
      list.push(r.occurredAt);
      map.set(r.userId, list);
    }
    return map;
  }
}

/** Is `now` (local minute) within [due, due + window), wrapping midnight? */
export function isDue(nowMinute: number, dueMinute: number): boolean {
  const delta = (nowMinute - dueMinute + 1440) % 1440;
  return delta < REMINDER_WINDOW_MIN;
}
