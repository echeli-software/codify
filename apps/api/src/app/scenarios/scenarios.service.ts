import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import {
  assertCanManageAttached,
  lessonForAuthor,
} from '../courses/course-ownership.js';
import {
  ProgressService,
  validateClientTimestamp,
} from '../progress/progress.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import {
  RateLimitedException,
  retryAfterSeconds,
} from '../exercises/rate-limit.js';
import type { CompletedQuest } from '../gamification/quests.service.js';
import type { UnlockedBadge } from '../gamification/badges.service.js';

/** One recorded play-through per 3 s per scenario (anti-spam on run rows). */
export const SCENARIO_RUN_COOLDOWN_MS = 3000;
import type { Prisma, Scenario } from '@prisma/client';
import {
  validateScenario,
  walkScenario,
  type ScenarioGraph,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import { scenarioEndingInfo } from '../progress/scenario-branch.js';

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
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
  /** True when an Idempotency-Key replay returned an already-recorded run. */
  replayed?: boolean;
}

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly progress: ProgressService,
  ) {}

  // ─── Admin ────────────────────────────────────────────────────────────

  async createForLesson(
    actor: ApiUser,
    lessonId: string,
    graph: ScenarioGraph,
  ): Promise<Scenario> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (lesson.scenarioId)
      throw new BadRequestException('Lesson already has a scenario');
    this.assertValid(graph);
    return this.prisma.$transaction(async (tx) => {
      const scenario = await tx.scenario.create({
        data: { graphJson: graph as unknown as Prisma.InputJsonValue },
      });
      await tx.lesson.update({
        where: { id: lessonId },
        data: { scenarioId: scenario.id, type: 'SCENARIO' },
      });
      return scenario;
    });
  }

  async update(
    actor: ApiUser,
    id: string,
    graph: ScenarioGraph,
  ): Promise<Scenario> {
    const existing = await this.prisma.scenario.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Scenario not found');
    await assertCanManageAttached(this.prisma, actor, { scenarioId: id });
    this.assertValid(graph);
    return this.prisma.scenario.update({
      where: { id },
      data: { graphJson: graph as unknown as Prisma.InputJsonValue },
    });
  }

  async getAdmin(actor: ApiUser, id: string): Promise<Scenario> {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });
    if (!scenario) throw new NotFoundException('Scenario not found');
    await assertCanManageAttached(this.prisma, actor, { scenarioId: id });
    return scenario;
  }

  async getAdminByLesson(
    actor: ApiUser,
    lessonId: string,
  ): Promise<Scenario | null> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (!lesson.scenarioId) return null;
    return this.prisma.scenario.findUnique({
      where: { id: lesson.scenarioId },
    });
  }

  // ─── Student ──────────────────────────────────────────────────────────

  async getForStudent(
    userId: string,
    lessonId: string,
  ): Promise<StudentScenarioView> {
    const lesson = await this.lessonWithScenario(lessonId);
    await this.assertAccess(userId, lessonId);
    const s = lesson.scenario!;
    const completed = await this.prisma.scenarioRun.findFirst({
      where: { userId, scenarioId: s.id, completed: true },
      select: { id: true },
    });
    return {
      id: s.id,
      lessonId,
      graph: s.graphJson as unknown as ScenarioGraph,
      alreadyCompleted: !!completed,
    };
  }

  /**
   * Record a play-through. Replayable; the reward fires only on the first
   * completion. Offline plays (docs/16 §7 `scenario_complete`) send an
   * `Idempotency-Key` (a replayed key returns the original run, no new row,
   * no cooldown) and the device `clientTimestamp` for streak attribution.
   */
  async complete(
    userId: string,
    scenarioId: string,
    choiceIds: string[],
    opts: { idempotencyKey?: string; clientTimestamp?: string } = {},
  ): Promise<CompleteResult> {
    const clientTimestamp = validateClientTimestamp(opts.clientTimestamp);
    const { scenario, lesson } = await this.scenarioWithLesson(scenarioId);
    await this.assertAccess(userId, lesson.id);

    const graph = scenario.graphJson as unknown as ScenarioGraph;
    const walk = walkScenario(graph, choiceIds);
    if (!walk.valid)
      throw new BadRequestException({
        code: 'INVALID_SCENARIO_PATH',
        message: walk.reason ?? 'Invalid path',
      });

    const recordKey = opts.idempotencyKey
      ? `scenario_complete:${userId}:${scenarioId}:${opts.idempotencyKey}`
      : null;
    const replay = recordKey
      ? await this.replayRun(
          recordKey,
          userId,
          lesson.id,
          scenarioId,
          clientTimestamp,
        )
      : null;
    if (replay) return replay;

    const last = await this.prisma.scenarioRun.findFirst({
      where: { userId, scenarioId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const wait = last
      ? retryAfterSeconds([last.createdAt], 1, SCENARIO_RUN_COOLDOWN_MS)
      : 0;
    if (wait > 0)
      throw new RateLimitedException(
        'Slow down — wait a few seconds before recording another play-through',
        wait,
        'SCENARIO_COOLDOWN',
      );

    const runData: Prisma.ScenarioRunUncheckedCreateInput = {
      userId,
      scenarioId,
      pathJson: choiceIds as unknown as Prisma.InputJsonValue,
      maxDepth: walk.depth,
      completed: walk.completed,
      outcome: walk.outcome ?? null,
    };
    let run: { id: string };
    try {
      run = !recordKey
        ? await this.prisma.scenarioRun.create({ data: runData })
        : await this.prisma.$transaction(async (tx) => {
            const created = await tx.scenarioRun.create({ data: runData });
            // Stored with the run; responseHash carries its id for replays.
            await tx.idempotencyRecord.create({
              data: {
                key: recordKey,
                scope: 'scenario_complete',
                userId,
                responseHash: created.id,
              },
            });
            return created;
          });
    } catch (err) {
      // A concurrent request with the same key won the race.
      if (recordKey && isUniqueViolation(err)) {
        const again = await this.replayRun(
          recordKey,
          userId,
          lesson.id,
          scenarioId,
          clientTimestamp,
        );
        if (again) return again;
      }
      throw err;
    }

    const result: CompleteResult = {
      runId: run.id,
      completed: walk.completed,
      depth: walk.depth,
      outcome: walk.outcome,
      path: walk.path,
    };

    // Replayable: every completion goes through recordCompletion, which only
    // rewards the first one (idempotent per user + lesson) — plus a smaller
    // SCENARIO_BRANCH reward when a later run reaches a new ending.
    if (walk.completed) {
      const scenarioEnding = await scenarioEndingInfo(this.prisma, {
        userId,
        scenarioId,
        graph,
        choiceIds,
        runId: run.id,
      });
      const done = await this.progress.recordCompletion({
        userId,
        lessonId: lesson.id,
        xpSource: 'SCENARIO_COMPLETE',
        coinSource: 'SCENARIO_COMPLETE',
        refType: 'scenario',
        refId: scenarioId,
        questEvent: 'scenario_complete',
        ...(clientTimestamp ? { clientTimestamp } : {}),
        ...(scenarioEnding ? { scenario: scenarioEnding } : {}),
      });
      if (!done.alreadyCompleted || done.retake) {
        result.reward = done.reward;
        result.questsCompleted = done.questsCompleted;
        result.badgesUnlocked = done.badgesUnlocked;
      }
    }
    return result;
  }

  /**
   * The run an Idempotency-Key already recorded, rebuilt (no new row). The
   * completion is re-asserted: recordCompletion is idempotent and finishes
   * the lesson if the original request died before it did.
   */
  private async replayRun(
    recordKey: string,
    userId: string,
    lessonId: string,
    scenarioId: string,
    clientTimestamp: string | null,
  ): Promise<CompleteResult | null> {
    const seen = await this.prisma.idempotencyRecord.findUnique({
      where: { key: recordKey },
      select: { responseHash: true },
    });
    if (!seen?.responseHash) return null;
    const run = await this.prisma.scenarioRun.findUnique({
      where: { id: seen.responseHash },
    });
    if (!run || run.userId !== userId || run.scenarioId !== scenarioId)
      return null;
    const result: CompleteResult = {
      runId: run.id,
      completed: run.completed,
      depth: run.maxDepth,
      outcome: run.outcome ?? undefined,
      path: (run.pathJson as unknown as string[]) ?? [],
      replayed: true,
    };
    if (run.completed) {
      const done = await this.progress.recordCompletion({
        userId,
        lessonId,
        xpSource: 'SCENARIO_COMPLETE',
        coinSource: 'SCENARIO_COMPLETE',
        refType: 'scenario',
        refId: scenarioId,
        questEvent: 'scenario_complete',
        ...(clientTimestamp ? { clientTimestamp } : {}),
      });
      if (!done.alreadyCompleted) {
        result.reward = done.reward;
        result.questsCompleted = done.questsCompleted;
        result.badgesUnlocked = done.badgesUnlocked;
      }
    }
    return result;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private assertValid(graph: ScenarioGraph): void {
    const errors = validateScenario(graph);
    if (errors.length)
      throw new BadRequestException({
        code: 'INVALID_SCENARIO',
        message: `Invalid scenario: ${errors.join('; ')}`,
        errors,
      });
  }

  private async lessonWithScenario(lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { scenario: true, module: { include: { course: true } } },
    });
    if (!lesson || !lesson.scenario)
      throw new NotFoundException('No scenario for this lesson');
    if (lesson.module.course.status !== 'PUBLISHED')
      throw new NotFoundException('Lesson not available');
    return lesson;
  }

  private async scenarioWithLesson(scenarioId: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: {
        lesson: { include: { module: { include: { course: true } } } },
      },
    });
    if (!scenario || !scenario.lesson)
      throw new NotFoundException('Scenario not found');
    return { scenario, lesson: scenario.lesson };
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted)
      throw new ForbiddenException('Subscription required for this lesson');
  }
}
