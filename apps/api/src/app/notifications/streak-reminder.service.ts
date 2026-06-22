import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push.provider.js';

export interface StreakReminderResult {
  candidates: number;
  pushed: number;
  pruned: number;
}

/**
 * Sends "keep your streak alive" pushes to users who have an active streak but
 * haven't done a streak-satisfying action *today* (in their own timezone).
 * In production a daily cron (per-timezone evening slot) calls run(); here an
 * admin endpoint triggers it on demand for verification. See /docs/17-mobile.md.
 */
@Injectable()
export class StreakReminderService {
  private readonly logger = new Logger(StreakReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async run(): Promise<StreakReminderResult> {
    const streaks = await this.prisma.streak.findMany({
      where: { currentDays: { gte: 1 } },
      include: { user: { select: { timezone: true, locale: true, deviceTokens: true } } },
    });

    const messages: PushMessage[] = [];
    let candidates = 0;
    const now = new Date();

    for (const s of streaks) {
      const tz = s.user.timezone || 'America/Sao_Paulo';
      // Already acted today (user-local)? Then the streak isn't at risk.
      if (localDate(s.lastActivityDate, tz) >= localDate(now, tz)) continue;
      if (s.user.deviceTokens.length === 0) continue;
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

    if (messages.length === 0) return { candidates, pushed: 0, pruned: 0 };

    const result = await this.push.send(messages);
    let pruned = 0;
    if (result.invalidTokens.length) {
      pruned = (await this.prisma.deviceToken.deleteMany({ where: { token: { in: result.invalidTokens } } })).count;
    }
    this.logger.log(`streak reminders: ${candidates} candidates, ${result.sent} pushed, ${pruned} stale tokens pruned`);
    return { candidates, pushed: result.sent, pruned };
  }
}

/** The user-local calendar date ('YYYY-MM-DD') of an instant. */
function localDate(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function reminderCopy(days: number, locale: string): { title: string; body: string } {
  if (locale.startsWith('pt')) {
    return { title: '🔥 Mantenha sua sequência!', body: `Você está há ${days} ${days === 1 ? 'dia' : 'dias'} seguidos. Faça uma lição hoje para não perder.` };
  }
  return { title: '🔥 Keep your streak alive!', body: `You're on a ${days}-day streak. Do a lesson today so you don't lose it.` };
}
