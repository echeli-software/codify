import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PushMessage } from './push.provider.js';
import { PushService } from './push.service.js';
import { isWithinQuietHours, localClock, quietWindow } from './quiet-hours.js';

export interface StreakReminderResult {
  candidates: number;
  pushed: number;
  pruned: number;
  /** Scheduled runs only: users skipped because they're in quiet hours. */
  skippedQuietHours?: number;
  /** Scheduled runs only: users already reminded for their local day. */
  alreadyReminded?: number;
}

export interface StreakReminderOptions {
  /**
   * `manual` (admin endpoint, verification): every at-risk user, now.
   * `scheduled` (hourly cron): only users whose local time is inside the
   * evening slot, outside their quiet hours, at most once per local day.
   */
  mode?: 'manual' | 'scheduled';
  now?: Date;
}

/**
 * Evening slot, user-local minutes [start, end). docs/10 §3 says "2h before
 * user-local midnight", but the default quiet hours start at 22:00 — so the
 * slot is the two hours *leading up to* quiet hours: 20:00–22:00. The
 * hourly cron hits it twice; the per-day idempotency record makes the
 * second pass a no-op (and lets a missed 20:00 run catch up at 21:00).
 */
export const EVENING_SLOT = { start: 20 * 60, end: 22 * 60 };

const IDEMPOTENCY_SCOPE = 'streak_reminder';

/**
 * "Keep your streak alive" pushes to users with an active streak who
 * haven't done a streak-satisfying action *today* in their own timezone.
 * See /docs/17-mobile.md §Push and /docs/10-engagement.md §3.
 */
@Injectable()
export class StreakReminderService {
  private readonly logger = new Logger(StreakReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async run(opts: StreakReminderOptions = {}): Promise<StreakReminderResult> {
    const scheduled = opts.mode === 'scheduled';
    const now = opts.now ?? new Date();
    const streaks = await this.prisma.streak.findMany({
      where: {
        currentDays: { gte: 1 },
        user: { deletedAt: null, deviceTokens: { some: {} } },
      },
      include: {
        user: {
          select: {
            id: true,
            timezone: true,
            locale: true,
            quietHoursStart: true,
            quietHoursEnd: true,
            deviceTokens: { select: { token: true } },
          },
        },
      },
    });

    const messages: PushMessage[] = [];
    let candidates = 0;
    let skippedQuietHours = 0;
    let alreadyReminded = 0;

    for (const s of streaks) {
      const today = localClock(now, s.user.timezone);
      // Already acted today (user-local)? Then the streak isn't at risk.
      // lastActivityDate stores the user-local date as UTC midnight (see
      // GamificationService.advanceStreak), so read its UTC calendar date —
      // converting it to the user's zone would shift it a day back west of UTC.
      if (s.lastActivityDate.toISOString().slice(0, 10) >= today.date) continue;
      if (s.user.deviceTokens.length === 0) continue;

      if (scheduled) {
        if (
          today.minutes < EVENING_SLOT.start ||
          today.minutes >= EVENING_SLOT.end
        )
          continue;
        const w = quietWindow(s.user.quietHoursStart, s.user.quietHoursEnd);
        if (isWithinQuietHours(today.minutes, w.start, w.end)) {
          skippedQuietHours += 1;
          continue;
        }
        if (!(await this.claimDay(s.user.id, today.date))) {
          alreadyReminded += 1;
          continue;
        }
      }

      candidates += 1;
      const { title, body } = reminderCopy(s.currentDays, s.user.locale);
      for (const dt of s.user.deviceTokens) {
        messages.push({
          token: dt.token,
          title,
          body,
          data: { type: 'streak_reminder', streakDays: String(s.currentDays) },
        });
      }
    }

    const result = await this.push.deliver(messages);
    this.logger.log(
      `streak reminders (${scheduled ? 'scheduled' : 'manual'}): ${candidates} candidates, ${result.sent} pushed, ${result.pruned} stale tokens pruned`,
    );
    const out: StreakReminderResult = {
      candidates,
      pushed: result.sent,
      pruned: result.pruned,
    };
    if (scheduled) Object.assign(out, { skippedQuietHours, alreadyReminded });
    return out;
  }

  /** Claim today's reminder for a user; false when already claimed. */
  private async claimDay(userId: string, localDate: string): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: `${IDEMPOTENCY_SCOPE}:${userId}:${localDate}`,
          scope: IDEMPOTENCY_SCOPE,
          userId,
        },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}

function reminderCopy(
  days: number,
  locale: string,
): { title: string; body: string } {
  if (locale.startsWith('pt')) {
    return {
      title: '🔥 Mantenha sua sequência!',
      body: `Você está há ${days} ${days === 1 ? 'dia' : 'dias'} seguidos. Faça uma lição hoje para não perder.`,
    };
  }
  return {
    title: '🔥 Keep your streak alive!',
    body: `You're on a ${days}-day streak. Do a lesson today so you don't lose it.`,
  };
}
