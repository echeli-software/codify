import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Scenario } from '@prisma/client';
import { validateScenario, walkScenario, type ScenarioGraph } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';

export interface StudentScenarioView {
  id: string;
  lessonId: string;
  graph: ScenarioGraph;
  alreadyCompleted: boolean;
}

export interface CompleteResult {
  runId: string;
  completed: boolean;
  depth: number;
  outcome?: string;
  path: string[];
  reward?: RewardResult;
  questsCompleted?: { id: string; title: string }[];
  badgesUnlocked?: { id: string; slug: string; name: string }[];
}

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gamification: GamificationService,
    private readonly quests: QuestsService,
    private readonly badges: BadgesService,
  ) {}

  // ─── Admin ────────────────────────────────────────────────────────────

  async createForLesson(lessonId: string, graph: ScenarioGraph): Promise<Scenario> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, deletedAt: null } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (lesson.scenarioId) throw new BadRequestException('Lesson already has a scenario');
    this.assertValid(graph);
    return this.prisma.$transaction(async (tx) => {
      const scenario = await tx.scenario.create({ data: { graphJson: graph as unknown as Prisma.InputJsonValue } });
      await tx.lesson.update({ where: { id: lessonId }, data: { scenarioId: scenario.id, type: 'SCENARIO' } });
      return scenario;
    });
  }

  async update(id: string, graph: ScenarioGraph): Promise<Scenario> {
    await this.prisma.scenario.findUniqueOrThrow({ where: { id } });
    this.assertValid(graph);
    return this.prisma.scenario.update({ where: { id }, data: { graphJson: graph as unknown as Prisma.InputJsonValue } });
  }

  getAdmin(id: string): Promise<Scenario> {
    return this.prisma.scenario.findUniqueOrThrow({ where: { id } });
  }

  async getAdminByLesson(lessonId: string): Promise<Scenario | null> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId }, include: { scenario: true } });
    return lesson?.scenario ?? null;
  }

  // ─── Student ──────────────────────────────────────────────────────────

  async getForStudent(userId: string, lessonId: string): Promise<StudentScenarioView> {
    const lesson = await this.lessonWithScenario(lessonId);
    await this.assertAccess(userId, lessonId);
    const s = lesson.scenario!;
    const completed = await this.prisma.scenarioRun.findFirst({ where: { userId, scenarioId: s.id, completed: true }, select: { id: true } });
    return { id: s.id, lessonId, graph: s.graphJson as unknown as ScenarioGraph, alreadyCompleted: !!completed };
  }

  /** Record a play-through. Replayable; the reward fires only on the first completion. */
  async complete(userId: string, scenarioId: string, choiceIds: string[]): Promise<CompleteResult> {
    const { scenario, lesson } = await this.scenarioWithLesson(scenarioId);
    await this.assertAccess(userId, lesson.id);

    const graph = scenario.graphJson as unknown as ScenarioGraph;
    const walk = walkScenario(graph, choiceIds);
    if (!walk.valid) throw new BadRequestException(walk.reason ?? 'Invalid path');

    const priorCompletion = await this.prisma.scenarioRun.findFirst({ where: { userId, scenarioId, completed: true }, select: { id: true } });

    const run = await this.prisma.scenarioRun.create({
      data: {
        userId,
        scenarioId,
        pathJson: choiceIds as unknown as Prisma.InputJsonValue,
        maxDepth: walk.depth,
        completed: walk.completed,
        outcome: walk.outcome ?? null,
      },
    });

    const result: CompleteResult = { runId: run.id, completed: walk.completed, depth: walk.depth, outcome: walk.outcome, path: walk.path };

    if (walk.completed && !priorCompletion) {
      const out = await this.grantFirstCompletion(userId, lesson, scenarioId);
      result.reward = out.reward;
      result.questsCompleted = out.questsCompleted;
      result.badgesUnlocked = out.badgesUnlocked;
    }
    return result;
  }

  // ─── Reward (first completion) ────────────────────────────────────────

  private async grantFirstCompletion(
    userId: string,
    lesson: { id: string; baseXp: number; baseCoins: number; module: { courseId: string } },
    scenarioId: string,
  ) {
    const courseId = lesson.module.courseId;
    const cats = await this.prisma.courseCategory.findMany({ where: { courseId }, select: { categoryId: true } });
    const categoryIds = cats.map((c) => c.categoryId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.progress.findUnique({ where: { userId_lessonId: { userId, lessonId: lesson.id } } });
      if (!existing) await tx.progress.create({ data: { userId, lessonId: lesson.id, xpAwarded: 0, coinsAwarded: 0 } });
      const reward = await this.gamification.grantReward(
        {
          userId,
          baseXp: lesson.baseXp,
          baseCoins: lesson.baseCoins,
          xpSource: 'SCENARIO_COMPLETE',
          coinSource: 'SCENARIO_COMPLETE',
          refType: 'scenario',
          refId: scenarioId,
          idempotencyKey: `scenario_complete:${userId}:${scenarioId}`,
          courseId,
          lessonId: lesson.id,
          countsForStreak: true,
        },
        tx,
      );
      if (!existing) {
        await tx.progress.update({ where: { userId_lessonId: { userId, lessonId: lesson.id } }, data: { xpAwarded: reward.xp, coinsAwarded: reward.coins } });
      }
      const questsCompleted = await this.quests.onEvent(tx, userId, { type: 'lesson_complete', courseId, categoryIds });
      const badgesUnlocked = await this.badges.evaluate(tx, userId);
      return { reward, questsCompleted, badgesUnlocked };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private assertValid(graph: ScenarioGraph): void {
    const errors = validateScenario(graph);
    if (errors.length) throw new BadRequestException(`Invalid scenario: ${errors.join('; ')}`);
  }

  private async lessonWithScenario(lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { scenario: true, module: { include: { course: true } } },
    });
    if (!lesson || !lesson.scenario) throw new NotFoundException('No scenario for this lesson');
    if (lesson.module.course.status !== 'PUBLISHED') throw new NotFoundException('Lesson not available');
    return lesson;
  }

  private async scenarioWithLesson(scenarioId: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: { lesson: { include: { module: { include: { course: true } } } } },
    });
    if (!scenario || !scenario.lesson) throw new NotFoundException('Scenario not found');
    return { scenario, lesson: scenario.lesson };
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted) throw new ForbiddenException('Subscription required for this lesson');
  }
}
