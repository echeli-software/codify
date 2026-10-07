import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, QuestKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from './gamification.service.js';
import { GamificationConfigService } from './gamification-config.service.js';
import { jobsEnabled } from './jobs.js';
import { pickDailyQuests, type PickableTemplate } from './quest-picker.js';

type PickableQuestTemplate = PickableTemplate;
/** Only users seen (or created) this recently get quests pre-assigned. */
const PREASSIGN_ACTIVE_DAYS = 14;
const PREASSIGN_BATCH = 500;

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = 'America/Sao_Paulo';

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
  type: 'lesson_complete' | 'exercise_pass';
  courseId?: string | null;
  categoryIds?: string[];
  xpEarned?: number;
  streakAdvanced?: boolean;
}

/**
 * Daily quests (docs/07 §8). `quest.dailyCount` (default 3) quests per local
 * day, drawn by a seeded weighted picker with one per difficulty band;
 * pre-assigned by an hourly job after local midnight, with lazy assignment
 * on first read as the fallback.
 * Progress advances inside the same transaction as the triggering reward;
 * completing a quest grants its flat reward via the gamification pipeline.
 */
@Injectable()
export class QuestsService {
  private readonly logger = new Logger(QuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly config: GamificationConfigService,
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

  /**
   * Assign the day's quests if the user has none for `forDate`. Safe under
   * races: the seeded picker returns the same templates for the same
   * (user, day), and the (userId, templateId, assignedFor) unique +
   * skipDuplicates make a concurrent second insert a no-op.
   */
  async ensureAssigned(
    userId: string,
    forDate: Date,
    templates?: PickableQuestTemplate[],
    count?: number,
  ): Promise<number> {
    const existing = await this.prisma.questAssignment.count({
      where: { userId, assignedFor: forDate },
    });
    if (existing > 0) return 0;
    const pool = templates ?? (await this.activeTemplates());
    const n = count ?? (await this.config.get('quest.dailyCount'));
    const picks = pickDailyQuests(
      pool,
      `${userId}:${forDate.toISOString().slice(0, 10)}`,
      n,
    );
    if (picks.length === 0) return 0;
    const res = await this.prisma.questAssignment.createMany({
      data: picks.map((t) => ({
        userId,
        templateId: t.id,
        assignedFor: forDate,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  private async activeTemplates(): Promise<PickableQuestTemplate[]> {
    const rows = await this.prisma.questTemplate.findMany({
      where: { isActive: true },
    });
    // `weight` is read when the column exists (QuestTemplate.weight); until
    // then every template draws with weight 1.
    return rows.map((t) => ({
      id: t.id,
      difficulty: t.difficulty,
      weight: (t as { weight?: number | null }).weight ?? 1,
    }));
  }

  /**
   * Hourly job: pre-assign today's quests for recently-active users whose
   * local midnight passed within the last hour, so quests are ready (and can
   * be announced) before the app is opened. Lazy assignment on first read
   * remains the fallback for everyone else.
   *
   * Wire with `@Cron(ENGAGEMENT_CRONS.questPreassign)` once @nestjs/schedule
   * is available on this branch; {@link runScheduledPreassign} is the entry.
   */
  async preassignForNewDay(
    now: Date = new Date(),
  ): Promise<{ timezones: number; users: number; assigned: number }> {
    const zones = await this.prisma.user.findMany({
      where: { deletedAt: null },
      distinct: ['timezone'],
      select: { timezone: true },
    });
    const due = zones
      .map((z) => z.timezone || DEFAULT_TZ)
      .filter((tz) => localHour(now, tz) === 0);
    if (due.length === 0) return { timezones: 0, users: 0, assigned: 0 };

    const templates = await this.activeTemplates();
    const count = await this.config.get('quest.dailyCount');
    if (templates.length === 0)
      return { timezones: due.length, users: 0, assigned: 0 };
    const activeSince = new Date(
      now.getTime() - PREASSIGN_ACTIVE_DAYS * 86_400_000,
    );

    let users = 0;
    let assigned = 0;
    for (const tz of due) {
      const forDate = localMidnightAt(now, tz);
      let cursor: string | undefined;
      for (;;) {
        const batch = await this.prisma.user.findMany({
          where: {
            deletedAt: null,
            timezone: tz,
            role: 'STUDENT',
            OR: [
              { lastSeenAt: { gte: activeSince } },
              { createdAt: { gte: activeSince } },
            ],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: PREASSIGN_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        for (const u of batch) {
          users += 1;
          assigned += await this.ensureAssigned(
            u.id,
            forDate,
            templates,
            count,
          );
        }
        cursor = batch[batch.length - 1].id;
        if (batch.length < PREASSIGN_BATCH) break;
      }
    }
    return { timezones: due.length, users, assigned };
  }

  /** Job entry point (no-op under jest or with JOBS_ENABLED=false). */
  async runScheduledPreassign(): Promise<{
    timezones: number;
    users: number;
    assigned: number;
  } | null> {
    if (!jobsEnabled()) return null;
    try {
      const res = await this.preassignForNewDay();
      if (res.users > 0) {
        this.logger.log(
          `quest pre-assign: ${res.assigned} quests for ${res.users} users in ${res.timezones} zones`,
        );
      }
      return res;
    } catch (err) {
      this.logger.error(`quest pre-assign failed: ${(err as Error).message}`);
      return null;
    }
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
        return ctx.type === 'lesson_complete' ? 1 : 0;
      case 'CATEGORY_LESSON_COUNT': {
        if (ctx.type !== 'lesson_complete') return 0;
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
    return localMidnightAt(new Date(), tz);
  }
}

/** UTC-midnight Date keyed to the local calendar day of `at` in `tz`. */
function localMidnightAt(at: Date, tz: string): Date {
  let key: string;
  try {
    key = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    key = at.toISOString().slice(0, 10);
  }
  return new Date(`${key}T00:00:00Z`);
}

/** Local hour (0–23) of `at` in `tz`; -1 for an unknown zone. */
export function localHour(at: Date, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at);
    return Number(h);
  } catch {
    return -1;
  }
}
