import { Injectable, Logger } from '@nestjs/common';
import { effectiveStreak } from '@codify/domain';
import { streakReminderCopy } from '../email/copy.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationService } from './notification.service.js';
import { HAS_PUSH_TARGET } from './push.service.js';
import { isWithinQuietHours, localClock, quietWindow } from './quiet-hours.js';

export interface StreakReminderResult {
  candidates: number;
  pushed: number;
  pruned: number;
  /** Scheduled runs only: users skipped because they're in quiet hours. */
  skippedQuietHours?: number;
  /** Scheduled runs only: users already reminded for their local day. */
  alreadyReminded?: number;
  /** Users over a push cap (docs/10 §3) — no push this time. */
  capped?: number;
}

export interface StreakReminderOptions {
  /**
   * `manual` (admin endpoint, verification): every at-risk user, now (the
   * evening slot and quiet hours are ignored; caps and preferences still
   * apply). `scheduled` (hourly cron): only users whose local time is
   * inside the evening slot, outside their quiet hours, at most once per
   * local day.
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
 * "Keep your streak alive" notifications to users with an active streak
 * who haven't done a streak-satisfying action *today* in their own
 * timezone, through NotificationService (inbox row + push with the
 * PushService delivery rules). Users who turned STREAK_REMINDER push off
 * are skipped entirely. See /docs/17-mobile.md §Push and
 * /docs/10-engagement.md §3.
 */
@Injectable()
export class StreakReminderService {
  private readonly logger = new Logger(StreakReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(opts: StreakReminderOptions = {}): Promise<StreakReminderResult> {
    const scheduled = opts.mode === 'scheduled';
    const now = opts.now ?? new Date();
    const streaks = await this.prisma.streak.findMany({
      where: {
        currentDays: { gte: 1 },
        user: {
          deletedAt: null,
          dormantAt: null,
          ...HAS_PUSH_TARGET,
          notificationPrefs: {
            none: { kind: 'STREAK_REMINDER', pushEnabled: false },
          },
        },
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
            _count: { select: { webPushSubscriptions: true } },
          },
        },
      },
    });

    let candidates = 0;
    let pushed = 0;
    let pruned = 0;
    let skippedQuietHours = 0;
    let alreadyReminded = 0;
    let capped = 0;

    for (const s of streaks) {
      const today = localClock(now, s.user.timezone);
      // Already acted today (user-local)? Then the streak isn't at risk.
      // lastActivityDate stores the user-local date as UTC midnight (see
      // GamificationService.advanceStreak), so read its UTC calendar date —
      // converting it to the user's zone would shift it a day back west of UTC.
      const lastKey = s.lastActivityDate.toISOString().slice(0, 10);
      if (lastKey >= today.date) continue;
      // Only a live streak can be "broken" (docs/07 §6): a row whose gap the
      // banked freezes can't cover is already lost — no "N-day streak" nag.
      const live = effectiveStreak(
        {
          currentDays: s.currentDays,
          longestDays: s.longestDays,
          freezesAvailable: s.freezesAvailable,
          lastActivityKey: lastKey,
        },
        today.date,
      );
      if (live.currentDays <= 0) continue;
      if (
        s.user.deviceTokens.length === 0 &&
        !(s.user._count?.webPushSubscriptions ?? 0)
      )
        continue;

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
      const days = live.currentDays;
      const res = await this.notifications.notify(
        s.user.id,
        ({ locale }) => ({
          kind: 'STREAK_REMINDER',
          ...streakReminderCopy(locale, days),
          data: { type: 'streak_reminder', streakDays: String(days) },
        }),
        { now, respectQuietHours: scheduled },
      );
      if (res.push.status === 'sent') {
        pushed += res.push.sent;
        pruned += res.push.pruned;
      } else if (res.push.status === 'capped') {
        capped += 1;
      }
    }

    this.logger.log(
      `streak reminders (${scheduled ? 'scheduled' : 'manual'}): ${candidates} candidates, ${pushed} pushed, ${pruned} stale tokens pruned`,
    );
    const out: StreakReminderResult = { candidates, pushed, pruned, capped };
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
