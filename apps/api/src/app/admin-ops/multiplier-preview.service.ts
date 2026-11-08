import { Injectable, NotFoundException } from '@nestjs/common';
import { resolveMultiplier, type MultiplierRule } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';

export interface MultiplierPreviewComponent {
  kind: string;
  value: number;
  description: string | null;
}

export interface MultiplierPreviewDimension {
  effective: number;
  uncapped: number;
  capped: boolean;
  components: MultiplierPreviewComponent[];
  /** Base reward of the lesson × effective, rounded like the ledger. */
  base: number;
  reward: number;
}

export interface MultiplierPreviewResponse {
  at: string;
  user: {
    id: string;
    displayName: string;
    isPremium: boolean;
    streakDays: number;
  };
  lesson: { id: string; courseId: string; title: string };
  cap: number;
  xp: MultiplierPreviewDimension;
  coins: MultiplierPreviewDimension;
}

/**
 * "Effective preview" (docs/04 Promotions): the resolver breakdown a user
 * would get for a lesson completion at `at`, computed with the same inputs
 * as the reward pipeline — every active multiplier row (the user's own
 * boosts included), premium status, current streak and `multiplier.cap` —
 * through `resolveMultiplier` from @codify/domain. Awards nothing.
 */
@Injectable()
export class MultiplierPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly config: GamificationConfigService,
  ) {}

  async preview(
    userId: string,
    lessonId: string,
    at = new Date(),
  ): Promise<MultiplierPreviewResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: {
        id: true,
        baseXp: true,
        baseCoins: true,
        module: {
          select: {
            courseId: true,
            course: { select: { sourceLocale: true } },
          },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const [rows, isPremium, streak, cap, title] = await Promise.all([
      this.prisma.multiplier.findMany({
        where: { isActive: true, OR: [{ userId: null }, { userId }] },
      }),
      this.access.hasActiveSubscription(userId),
      this.prisma.streak.findUnique({
        where: { userId },
        select: { currentDays: true },
      }),
      this.config.get('multiplier.cap'),
      this.prisma.contentTranslation.findFirst({
        where: {
          entityType: 'LESSON',
          entityId: lessonId,
          field: 'title',
          locale: lesson.module.course.sourceLocale,
        },
        select: { value: true },
      }),
    ]);
    const rules = rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      target: m.target,
      value: Number(m.value),
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      courseId: m.courseId,
      lessonId: m.lessonId,
      streakDaysMin: m.streakDaysMin,
      userId: m.userId,
      description: m.description,
    })) as MultiplierRule[];
    const streakDays = streak?.currentDays ?? 0;
    const resolved = resolveMultiplier({
      multipliers: rules,
      isPremium,
      courseId: lesson.module.courseId,
      lessonId,
      streakDays,
      userId,
      now: at,
      cap,
    } as Parameters<typeof resolveMultiplier>[0]);
    const dim = (
      r: (typeof resolved)['xp'],
      base: number,
    ): MultiplierPreviewDimension => ({
      effective: r.effective,
      uncapped: r.uncapped,
      capped: r.capped,
      components: r.components.map((c) => ({
        kind: c.kind,
        value: c.value,
        description: c.description ?? null,
      })),
      base,
      reward: Math.round(base * r.effective),
    });
    return {
      at: at.toISOString(),
      user: { ...user, isPremium, streakDays },
      lesson: {
        id: lesson.id,
        courseId: lesson.module.courseId,
        title: title?.value ?? lesson.id,
      },
      cap,
      xp: dim(resolved.xp, lesson.baseXp),
      coins: dim(resolved.coins, lesson.baseCoins),
    };
  }
}
