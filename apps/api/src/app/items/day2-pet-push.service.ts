import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { jobsEnabled } from '../gamification/jobs.js';
import { NotificationService } from '../notifications/notification.service.js';
import { HAS_PUSH_TARGET } from '../notifications/push.service.js';
import {
  isWithinQuietHours,
  localClock,
  quietWindow,
} from '../notifications/quiet-hours.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Default daily reminder (docs/05 Onboarding "Schedule": 8 PM local). */
export const DEFAULT_REMINDER_MINUTE = 20 * 60;
const SCOPE = 'day2_pet_push';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Day2PushResult {
  candidates: number;
  sent: number;
  skipped: number;
}

/** "YYYY-MM-DD" + 1 day. */
export function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The Day-2 push copy (docs/10 §2: "[Pet name] is waiting."): the starter
 * pet's nickname, else the legacy `User.petName`, else "Your pet".
 */
export function day2Copy(locale: string, petName: string | null) {
  const pt = locale.startsWith('pt');
  const pet = petName ?? (pt ? 'Seu pet' : 'Your pet');
  return {
    kind: 'STREAK_REMINDER' as const,
    title: pt ? `🐾 ${pet} está te esperando!` : `🐾 ${pet} is waiting!`,
    body: pt
      ? 'Uma lição rápida hoje mantém o ritmo.'
      : 'A quick lesson today keeps you going.',
    deepLink: '/today',
    data: { type: 'day2_pet' },
  };
}

/**
 * Day-2 return push (docs/10 §2): the day after onboarding, at the
 * reminder time the learner picked (`reminderMinute`, default 20:00
 * user-local), "[pet] is waiting" — once per user, only when they haven't
 * already come back and completed a lesson that day. Sent as a
 * STREAK_REMINDER through NotificationService, so per-kind toggles, quiet
 * hours, daily/weekly caps and dormancy all apply.
 */
@Injectable()
export class Day2PetPushService {
  private readonly logger = new Logger(Day2PetPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(now: Date = new Date()): Promise<Day2PushResult> {
    // Onboarded 1–3 days ago covers every time zone's "tomorrow".
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        dormantAt: null,
        role: 'STUDENT',
        onboardedAt: {
          gte: new Date(now.getTime() - 3 * DAY_MS),
          lte: new Date(now.getTime() - 6 * 60 * 60 * 1000),
        },
        ...HAS_PUSH_TARGET,
        notificationPrefs: {
          none: { kind: 'STREAK_REMINDER', pushEnabled: false },
        },
      },
      select: {
        id: true,
        timezone: true,
        onboardedAt: true,
        reminderMinute: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        petName: true,
        // The starter pet's own name (docs/08 §10).
        items: {
          where: { source: 'ONBOARDING', item: { slot: 'PET' } },
          select: { nickname: true },
          take: 1,
        },
      },
    });
    let candidates = 0;
    let sent = 0;
    let skipped = 0;
    for (const u of users) {
      if (!u.onboardedAt) continue;
      const today = localClock(now, u.timezone);
      const onboardedOn = localClock(u.onboardedAt, u.timezone).date;
      if (today.date !== nextDate(onboardedOn)) continue;
      const at = u.reminderMinute ?? DEFAULT_REMINDER_MINUTE;
      // The hourly job lands once inside [reminder, reminder + 60).
      if (today.minutes < at || today.minutes >= at + 60) continue;
      const w = quietWindow(u.quietHoursStart, u.quietHoursEnd);
      if (isWithinQuietHours(today.minutes, w.start, w.end)) {
        skipped += 1;
        continue;
      }
      // Already back today (user-local)? No need to call them back.
      const sinceMidnight = new Date(now.getTime() - today.minutes * 60_000);
      const back = await this.prisma.progress.count({
        where: { userId: u.id, completedAt: { gte: sinceMidnight } },
      });
      if (back > 0) {
        skipped += 1;
        continue;
      }
      if (!(await this.claim(u.id))) continue;
      candidates += 1;
      const res = await this.notifications.notify(
        u.id,
        ({ locale }) =>
          day2Copy(locale, u.items[0]?.nickname ?? u.petName ?? null),
        { now, respectQuietHours: true },
      );
      if (res.push.status === 'sent') sent += 1;
    }
    return { candidates, sent, skipped };
  }

  /** Hourly (minute 40, UTC). No-op under jest or with JOBS_ENABLED=false. */
  @Cron('40 * * * *', { name: 'runDay2PetPush', timeZone: 'UTC' })
  async runScheduled(): Promise<Day2PushResult | null> {
    if (!jobsEnabled()) return null;
    try {
      const res = await this.run();
      if (res.candidates)
        this.logger.log(
          `day-2 pet push: ${res.candidates} candidates, ${res.sent} sent`,
        );
      return res;
    } catch (err) {
      this.logger.error(`day-2 pet push failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async claim(userId: string): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key: `${SCOPE}:${userId}`, scope: SCOPE, userId },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}
