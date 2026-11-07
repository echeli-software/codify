import { Injectable, Logger } from '@nestjs/common';
import { QuestsService } from '../gamification/quests.service.js';
import {
  copyLocale,
  welcomeBackQuestTitle,
  type CopyLocale,
} from '../email/copy.js';
import { localClock } from '../notifications/quiet-hours.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { localDateKey } from './claims.js';

/** Default reward of the welcome-back quest (admin-editable on the template). */
export const WELCOME_BACK_COINS = 150;
export const WELCOME_BACK_XP = 50;

export const welcomeBackSlug = (locale: CopyLocale) =>
  `welcome-back-${locale.toLowerCase()}`;

/**
 * docs/10 §13 day 14: "a 'welcome back' quest — generous coin reward for
 * returning". Implemented as an extra quest assignment on the day the
 * user comes back: a LESSON_COUNT(1) template per locale, created on
 * first use and kept `isActive: false` so the daily picker never draws
 * it. It rides the normal quest pipeline — progress on the next lesson,
 * reward through GamificationService.grantReward (DAILY_QUEST source,
 * idempotent per assignment). Admins can tune its reward in Quests.
 */
@Injectable()
export class WelcomeBackQuest {
  private readonly logger = new Logger(WelcomeBackQuest.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quests: QuestsService,
  ) {}

  /** The template for a locale (created on first use). */
  async template(locale: string): Promise<{ id: string; coinReward: number }> {
    const loc = copyLocale(locale);
    const slug = welcomeBackSlug(loc);
    const existing = await this.prisma.questTemplate.findUnique({
      where: { slug },
      select: { id: true, coinReward: true },
    });
    if (existing) return existing;
    return this.prisma.questTemplate.upsert({
      where: { slug },
      create: {
        slug,
        kind: 'LESSON_COUNT',
        title: welcomeBackQuestTitle(loc),
        difficulty: 1,
        weight: 1,
        target: 1,
        coinReward: WELCOME_BACK_COINS,
        xpReward: WELCOME_BACK_XP,
        isActive: false,
      },
      update: {},
      select: { id: true, coinReward: true },
    });
  }

  /**
   * Assign it for the user's local today, after today's regular quests
   * (so lazy daily assignment still happens). Idempotent.
   */
  async assign(
    userId: string,
    timezone: string | null | undefined,
    locale: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const forDate = localDateKey(localClock(now, timezone).date);
    const tpl = await this.template(locale);
    await this.quests.ensureAssigned(userId, forDate);
    const res = await this.prisma.questAssignment.createMany({
      data: [{ userId, templateId: tpl.id, assignedFor: forDate }],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      this.logger.log(`welcome-back quest assigned to ${userId}`);
    }
    return res.count > 0;
  }
}
