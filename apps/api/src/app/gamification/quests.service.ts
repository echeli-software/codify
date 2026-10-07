import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, QuestKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from './gamification.service.js';

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = 'America/Sao_Paulo';
const DAILY_COUNT = 3;

export interface QuestView {
  id: string;
  templateId: string;
  slug: string;
  kind: QuestKind;
  title: string;
  target: number;
  progress: number;
  completed: boolean;
  xpReward: number;
  coinReward: number;
  difficulty: number;
}

export interface CompletedQuest {
  id: string;
  title: string;
  xpReward: number;
  coinReward: number;
}

export interface QuestTemplateInput {
  slug: string;
  kind: QuestKind;
  title: string;
  difficulty?: number;
  target: number;
  paramsJson?: Record<string, unknown> | null;
  xpReward?: number;
  coinReward?: number;
  isActive?: boolean;
}

/** Context for advancing quest progress after a reward-bearing event. */
export interface QuestEventContext {
  /**
   * Which flow completed the lesson. Every kind is also a lesson
   * completion (it arrives through ProgressService.recordCompletion), so
   * lesson-count quests advance on all of them; kind-specific quests
   * (e.g. EXERCISE_PASS) only on their own kind.
   */
  type:
    | 'lesson_complete'
    | 'quiz_pass'
    | 'exercise_pass'
    | 'ai_prompt_pass'
    | 'scenario_complete'
    | 'capstone_pass';
  courseId?: string | null;
  categoryIds?: string[];
  xpEarned?: number;
  streakAdvanced?: boolean;
}

/**
 * Daily quests (docs/07 §8). Three quests per local day, lazily assigned on
 * first read (no cron needed for the MVP) with a one-per-difficulty mix.
 * Progress advances inside the same transaction as the triggering reward;
 * completing a quest grants its flat reward via the gamification pipeline.
 */
@Injectable()
export class QuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // ─── Templates (admin) ─────────────────────────────────────────────────

  listTemplates(includeInactive: boolean) {
    return this.prisma.questTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ difficulty: 'asc' }, { slug: 'asc' }],
    });
  }

  async createTemplate(input: QuestTemplateInput) {
    const dupe = await this.prisma.questTemplate.findUnique({
      where: { slug: input.slug },
    });
    if (dupe) throw new ConflictException('Slug already in use');
    return this.prisma.questTemplate.create({
      data: {
        slug: input.slug,
        kind: input.kind,
        title: input.title,
        difficulty: input.difficulty ?? 1,
        target: input.target,
        paramsJson: (input.paramsJson ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        xpReward: input.xpReward ?? 0,
        coinReward: input.coinReward ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateTemplate(id: string, patch: Partial<QuestTemplateInput>) {
    const target = await this.prisma.questTemplate.findUnique({
      where: { id },
    });
    if (!target) throw new NotFoundException('Quest template not found');
    return this.prisma.questTemplate.update({
      where: { id },
      data: {
        kind: patch.kind,
        title: patch.title,
        difficulty: patch.difficulty,
        target: patch.target,
        paramsJson: (patch.paramsJson ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        xpReward: patch.xpReward,
        coinReward: patch.coinReward,
        isActive: patch.isActive,
      },
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    const target = await this.prisma.questTemplate.findUnique({
      where: { id },
    });
    if (!target) throw new NotFoundException('Quest template not found');
    await this.prisma.questTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Daily assignment + read ────────────────────────────────────────────

  /** Today's quests for a user, assigning them on first read of the day. */
  async listToday(userId: string, timezone?: string): Promise<QuestView[]> {
    const tz = timezone || (await this.userTz(userId));
    const forDate = this.localMidnight(tz);
    await this.ensureAssigned(userId, forDate);
    const rows = await this.prisma.questAssignment.findMany({
      where: { userId, assignedFor: forDate },
      include: { template: true },
      orderBy: { template: { difficulty: 'asc' } },
    });
    return rows.map((a) => ({
      id: a.id,
      templateId: a.templateId,
      slug: a.template.slug,
      kind: a.template.kind,
      title: a.template.title,
      target: a.template.target,
      progress: a.progress,
      completed: a.completedAt != null,
      xpReward: a.template.xpReward,
      coinReward: a.template.coinReward,
      difficulty: a.template.difficulty,
    }));
  }

  private async ensureAssigned(userId: string, forDate: Date): Promise<void> {
    const existing = await this.prisma.questAssignment.count({
      where: { userId, assignedFor: forDate },
    });
    if (existing > 0) return;
    const picks = await this.pickDaily();
    if (picks.length === 0) return;
    await this.prisma.questAssignment.createMany({
      data: picks.map((t) => ({
        userId,
        templateId: t.id,
        assignedFor: forDate,
      })),
      skipDuplicates: true,
    });
  }

  /** One easy / medium / hard where available, filled up to DAILY_COUNT. */
  private async pickDaily() {
    const active = await this.prisma.questTemplate.findMany({
      where: { isActive: true },
      orderBy: { slug: 'asc' },
    });
    if (active.length === 0) return [];
    const picks: typeof active = [];
    const used = new Set<string>();
    for (const diff of [1, 2, 3]) {
      const t = active.find((x) => x.difficulty === diff && !used.has(x.id));
      if (t) {
        picks.push(t);
        used.add(t.id);
      }
    }
    for (const t of active) {
      if (picks.length >= DAILY_COUNT) break;
      if (!used.has(t.id)) {
        picks.push(t);
        used.add(t.id);
      }
    }
    return picks.slice(0, DAILY_COUNT);
  }

  // ─── Progress on events ─────────────────────────────────────────────────

  /**
   * Advance the user's active quests for today after a reward event. Runs in
   * the caller's transaction so quest rewards land atomically with the event.
   * Returns the quests that just completed.
   */
  async onEvent(
    tx: Tx,
    userId: string,
    ctx: QuestEventContext,
  ): Promise<CompletedQuest[]> {
    const u = await tx.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const forDate = this.localMidnight(u?.timezone || DEFAULT_TZ);
    const assignments = await tx.questAssignment.findMany({
      where: { userId, assignedFor: forDate, completedAt: null },
      include: { template: true },
    });

    const completed: CompletedQuest[] = [];
    for (const a of assignments) {
      const inc = this.incrementFor(a.template.kind, a.template, ctx);
      if (inc <= 0) continue;
      const progress = Math.min(a.progress + inc, a.template.target);
      const isDone = progress >= a.template.target;
      await tx.questAssignment.update({
        where: { id: a.id },
        data: { progress, completedAt: isDone ? new Date() : null },
      });
      if (isDone) {
        await this.gamification.grantReward(
          {
            userId,
            baseXp: a.template.xpReward,
            baseCoins: a.template.coinReward,
            xpSource: 'DAILY_QUEST',
            coinSource: 'DAILY_QUEST',
            refType: 'quest',
            refId: a.id,
            idempotencyKey: `quest:${a.id}`,
            flat: true,
          },
          tx,
        );
        completed.push({
          id: a.id,
          title: a.template.title,
          xpReward: a.template.xpReward,
          coinReward: a.template.coinReward,
        });
      }
    }
    return completed;
  }

  private incrementFor(
    kind: QuestKind,
    template: { paramsJson: unknown; target: number },
    ctx: QuestEventContext,
  ): number {
    switch (kind) {
      case 'LESSON_COUNT':
        return 1;
      case 'CATEGORY_LESSON_COUNT': {
        const params = (template.paramsJson ?? {}) as { categoryId?: string };
        if (!params.categoryId) return 1; // un-scoped → any lesson counts
        return ctx.categoryIds?.includes(params.categoryId) ? 1 : 0;
      }
      case 'XP_AMOUNT':
        return ctx.xpEarned ?? 0;
      case 'EXERCISE_PASS':
        return ctx.type === 'exercise_pass' ? 1 : 0;
      case 'STREAK_MAINTAIN':
        return ctx.streakAdvanced ? template.target : 0;
      default:
        return 0;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async userTz(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return u?.timezone || DEFAULT_TZ;
  }

  /** UTC-midnight Date keyed to the user's local calendar day. */
  private localMidnight(tz: string): Date {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${key}T00:00:00Z`);
  }
}
