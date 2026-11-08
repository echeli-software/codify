import { Injectable, Logger } from '@nestjs/common';
import { effectiveStreak, localDateKey } from '@codify/domain';
import { toStreakState } from '../gamification/gamification.service.js';
import { weeklyRecapCopy, weeklyRecapLines } from '../email/copy.js';
import { NotificationService } from '../notifications/notification.service.js';
import { localWeekStart } from '../notifications/push.service.js';
import { localClock } from '../notifications/quiet-hours.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { claimOnce } from './claims.js';

const SCOPE = 'weekly_recap';
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Monday morning, user-local: [09:00, 12:00) so a missed hourly run catches up. */
const SEND_FROM_MIN = 9 * 60;
const SEND_UNTIL_MIN = 12 * 60;
/** Only people active recently get a recap (lapsed users: §13). */
const ACTIVE_DAYS = 14;

export interface WeeklyRecapResult {
  zones: number;
  candidates: number;
  sent: number;
  emailed: number;
  noActivity: number;
  alreadySent: number;
}

export interface WeeklyRecapOptions {
  /** `manual` ignores the Monday-morning window (verification aid). */
  mode?: 'scheduled' | 'manual';
  now?: Date;
  /** Manual runs only: limit to one user. */
  userId?: string;
}

/**
 * Weekly recap (docs/10 §3 "weekly recap (opt-in default)"): Monday
 * 09:00–12:00 user-local, an inbox entry + email summarising last week's
 * XP, lessons and streak. On by default; respects the kind's emailEnabled
 * (unsubscribe link). Skipped when the user did nothing last week (no
 * "we miss you" without content). Idempotent per user per ISO week.
 */
@Injectable()
export class WeeklyRecapService {
  private readonly logger = new Logger(WeeklyRecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(opts: WeeklyRecapOptions = {}): Promise<WeeklyRecapResult> {
    const now = opts.now ?? new Date();
    const manual = opts.mode === 'manual';
    const out: WeeklyRecapResult = {
      zones: 0,
      candidates: 0,
      sent: 0,
      emailed: 0,
      noActivity: 0,
      alreadySent: 0,
    };

    const zones = await this.prisma.user.findMany({
      where: { deletedAt: null },
      distinct: ['timezone'],
      select: { timezone: true },
    });
    const due = zones
      .map((z) => z.timezone)
      .filter((tz) => manual || isRecapTime(now, tz));
    out.zones = due.length;

    for (const tz of due) {
      const clock = localClock(now, tz);
      const thisWeek = localWeekStart(now, clock);
      const lastWeek = new Date(thisWeek.getTime() - 7 * DAY_MS);
      const weekKey = localClock(thisWeek, tz).date;
      let cursor: string | undefined;
      for (;;) {
        const users = await this.prisma.user.findMany({
          where: {
            timezone: tz,
            role: 'STUDENT',
            deletedAt: null,
            dormantAt: null,
            suspendedAt: null,
            ...(manual && opts.userId ? { id: opts.userId } : {}),
            lastSeenAt: {
              gte: new Date(now.getTime() - ACTIVE_DAYS * DAY_MS),
            },
            notificationPrefs: {
              none: { kind: 'WEEKLY_RECAP', emailEnabled: false },
            },
          },
          select: {
            id: true,
            timezone: true,
            streak: {
              select: {
                currentDays: true,
                longestDays: true,
                freezesAvailable: true,
                lastActivityDate: true,
              },
            },
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (users.length === 0) break;
        const ids = users.map((u) => u.id);
        const range = { gte: lastWeek, lt: thisWeek };
        const [xp, lessons] = await Promise.all([
          this.prisma.xpEvent.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, createdAt: range },
            _sum: { amount: true },
          }),
          this.prisma.progress.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, completedAt: range },
            _count: { _all: true },
          }),
        ]);
        const xpBy = new Map(xp.map((r) => [r.userId, r._sum.amount ?? 0]));
        const lessonsBy = new Map(
          lessons.map((r) => [r.userId, r._count._all]),
        );

        for (const u of users) {
          out.candidates += 1;
          const stats = {
            xp: xpBy.get(u.id) ?? 0,
            lessons: lessonsBy.get(u.id) ?? 0,
            // Settled for today (a lapsed streak reads 0, not the stale row).
            streakDays: effectiveStreak(
              u.streak ? toStreakState(u.streak) : null,
              localDateKey(now, u.timezone),
            ).currentDays,
          };
          if (stats.xp <= 0 && stats.lessons <= 0) {
            out.noActivity += 1;
            continue;
          }
          if (
            !(await claimOnce(this.prisma, SCOPE, `${u.id}:${weekKey}`, u.id))
          ) {
            out.alreadySent += 1;
            continue;
          }
          const res = await this.notifications.notify(
            u.id,
            ({ locale }) => ({
              kind: 'WEEKLY_RECAP',
              ...weeklyRecapCopy(locale, stats),
              deepLink: '/today',
              emailLines: weeklyRecapLines(locale, stats),
              data: { type: 'weekly_recap', week: weekKey },
            }),
            { now },
          );
          out.sent += 1;
          if (res.email.status === 'sent') out.emailed += 1;
        }
        cursor = users[users.length - 1].id;
        if (users.length < BATCH) break;
      }
    }
    if (out.sent > 0 || manual) {
      this.logger.log(
        `weekly recap: ${out.sent} sent (${out.emailed} emailed) in ${out.zones} zones`,
      );
    }
    return out;
  }
}

/** Monday 09:00–12:00 in `tz`? */
export function isRecapTime(now: Date, tz: string): boolean {
  const c = localClock(now, tz);
  const weekday = new Date(`${c.date}T00:00:00Z`).getUTCDay();
  return (
    weekday === 1 && c.minutes >= SEND_FROM_MIN && c.minutes < SEND_UNTIL_MIN
  );
}
