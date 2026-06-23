import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AiPrompt, Prisma } from '@prisma/client';
import {
  gradeDeterministicCriterion,
  isLlmCriterion,
  scoreRubric,
  type CriterionResult,
  type RubricCriterion,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import { AI_GRADER, type AiGrader } from './ai-grading.provider.js';

const SUBMIT_COOLDOWN_MS = 3000;

export interface AiPromptInput {
  promptText: string;
  contextText?: string | null;
  rubric: RubricCriterion[];
  passThreshold?: number;
  maxAttempts?: number;
}

export interface StudentAiPromptView {
  id: string;
  lessonId: string;
  promptText: string;
  contextText: string | null;
  passThreshold: number;
  maxAttempts: number;
  attemptsUsed: number;
  alreadyPassed: boolean;
  /** Rubric checklist — labels + weights only (configs are hidden). */
  rubric: { id: string; label: string; weight: number }[];
}

export interface GradeResult {
  submissionId: string;
  scorePct: number;
  passed: boolean;
  gradedBy: 'HEURISTIC' | 'LLM';
  cached: boolean;
  results: CriterionResult[];
  reward?: RewardResult;
  questsCompleted?: { id: string; title: string }[];
  badgesUnlocked?: { id: string; slug: string; name: string }[];
}

@Injectable()
export class AiGradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gamification: GamificationService,
    private readonly quests: QuestsService,
    private readonly badges: BadgesService,
    @Inject(AI_GRADER) private readonly grader: AiGrader,
  ) {}

  // ─── Admin ────────────────────────────────────────────────────────────

  async createForLesson(lessonId: string, input: AiPromptInput): Promise<AiPrompt> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, deletedAt: null } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (lesson.aiPromptId) throw new BadRequestException('Lesson already has an AI prompt');
    return this.prisma.$transaction(async (tx) => {
      const prompt = await tx.aiPrompt.create({ data: this.toData(input) });
      await tx.lesson.update({ where: { id: lessonId }, data: { aiPromptId: prompt.id, type: 'AI_PROMPT' } });
      return prompt;
    });
  }

  async update(id: string, patch: Partial<AiPromptInput>): Promise<AiPrompt> {
    await this.prisma.aiPrompt.findUniqueOrThrow({ where: { id } });
    return this.prisma.aiPrompt.update({ where: { id }, data: this.toData(patch, true) });
  }

  getAdmin(id: string): Promise<AiPrompt> {
    return this.prisma.aiPrompt.findUniqueOrThrow({ where: { id } });
  }

  async getAdminByLesson(lessonId: string): Promise<AiPrompt | null> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId }, include: { aiPrompt: true } });
    return lesson?.aiPrompt ?? null;
  }

  /** Grade a sample response without persisting — lets admins test a rubric. */
  async preview(id: string, response: string): Promise<{ scorePct: number; passed: boolean; results: CriterionResult[] }> {
    const prompt = await this.prisma.aiPrompt.findUniqueOrThrow({ where: { id } });
    const grade = await this.grade(prompt, response);
    return { scorePct: grade.scorePct, passed: grade.passed, results: grade.results };
  }

  // ─── Student ──────────────────────────────────────────────────────────

  async getForStudent(userId: string, lessonId: string): Promise<StudentAiPromptView> {
    const lesson = await this.lessonWithPrompt(lessonId);
    await this.assertAccess(userId, lessonId);
    const p = lesson.aiPrompt!;
    const [passed, attempts] = await Promise.all([
      this.prisma.aiSubmission.findFirst({ where: { userId, aiPromptId: p.id, passed: true }, select: { id: true } }),
      this.prisma.aiSubmission.count({ where: { userId, aiPromptId: p.id } }),
    ]);
    return {
      id: p.id,
      lessonId,
      promptText: p.promptText,
      contextText: p.contextText,
      passThreshold: p.passThreshold,
      maxAttempts: p.maxAttempts,
      attemptsUsed: attempts,
      alreadyPassed: !!passed,
      rubric: toCriteria(p.rubricJson).map((c) => ({ id: c.id, label: c.label, weight: c.weight })),
    };
  }

  async submit(userId: string, aiPromptId: string, response: string): Promise<GradeResult> {
    const { prompt, lesson } = await this.promptWithLesson(aiPromptId);
    await this.assertAccess(userId, lesson.id);

    const recent = await this.prisma.aiSubmission.findFirst({
      where: { userId, aiPromptId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, response: true },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < SUBMIT_COOLDOWN_MS) {
      throw new HttpException('Slow down — wait a few seconds between submissions', 429);
    }

    const totalAttempts = await this.prisma.aiSubmission.count({ where: { userId, aiPromptId } });
    const alreadyPassed = await this.prisma.aiSubmission.findFirst({ where: { userId, aiPromptId, passed: true }, select: { id: true } });
    if (prompt.maxAttempts > 0 && totalAttempts >= prompt.maxAttempts && !alreadyPassed) {
      throw new ForbiddenException('No attempts left for this prompt');
    }

    // Cache: an identical response from this user reuses the prior grade.
    const cachedSub = await this.prisma.aiSubmission.findFirst({
      where: { userId, aiPromptId, response },
      orderBy: { createdAt: 'desc' },
    });

    let scorePct: number;
    let passed: boolean;
    let results: CriterionResult[];
    let gradedBy: 'HEURISTIC' | 'LLM';
    let cached = false;

    if (cachedSub) {
      scorePct = cachedSub.scorePct;
      passed = cachedSub.passed;
      results = (cachedSub.breakdownJson as unknown as CriterionResult[]) ?? [];
      gradedBy = cachedSub.gradedBy;
      cached = true;
    } else {
      const grade = await this.grade(prompt, response);
      scorePct = grade.scorePct;
      passed = grade.passed;
      results = grade.results;
      gradedBy = grade.gradedBy;
    }

    const submission = await this.prisma.aiSubmission.create({
      data: {
        userId,
        aiPromptId,
        response,
        scorePct,
        passed,
        breakdownJson: results as unknown as Prisma.InputJsonValue,
        gradedBy,
        cached,
      },
    });

    const result: GradeResult = { submissionId: submission.id, scorePct, passed, gradedBy, cached, results };

    if (passed && !alreadyPassed) {
      const out = await this.grantFirstPass(userId, lesson, aiPromptId);
      result.reward = out.reward;
      result.questsCompleted = out.questsCompleted;
      result.badgesUnlocked = out.badgesUnlocked;
    }
    return result;
  }

  // ─── Grading core ─────────────────────────────────────────────────────

  private async grade(prompt: AiPrompt, response: string) {
    const criteria = toCriteria(prompt.rubricJson);
    const deterministic: CriterionResult[] = [];
    const llm: RubricCriterion[] = [];
    for (const c of criteria) {
      const det = gradeDeterministicCriterion(response, c);
      if (det) deterministic.push(det);
      else if (isLlmCriterion(c)) llm.push(c);
    }
    const llmResults = llm.length
      ? await this.grader.judge(response, llm, { promptText: prompt.promptText, contextText: prompt.contextText })
      : [];

    // Re-assemble in the rubric's original order.
    const byId = new Map<string, CriterionResult>();
    for (const r of [...deterministic, ...llmResults]) byId.set(r.id, r);
    const results = criteria.map((c) => byId.get(c.id)).filter((r): r is CriterionResult => !!r);

    const { scorePct, passed } = scoreRubric(results, prompt.passThreshold);
    const gradedBy: 'HEURISTIC' | 'LLM' = llm.length && this.grader.mode === 'llm' ? 'LLM' : 'HEURISTIC';
    return { scorePct, passed, results, gradedBy };
  }

  private async grantFirstPass(
    userId: string,
    lesson: { id: string; baseXp: number; baseCoins: number; module: { courseId: string } },
    aiPromptId: string,
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
          xpSource: 'AI_PROMPT_PASS',
          coinSource: 'AI_PROMPT_PASS',
          refType: 'ai_prompt',
          refId: aiPromptId,
          idempotencyKey: `ai_prompt_pass:${userId}:${aiPromptId}`,
          courseId,
          lessonId: lesson.id,
          countsForStreak: true,
        },
        tx,
      );
      if (!existing) {
        await tx.progress.update({ where: { userId_lessonId: { userId, lessonId: lesson.id } }, data: { xpAwarded: reward.xp, coinsAwarded: reward.coins } });
      }
      // An AI-prompt pass completes the lesson → credits lesson-count quests.
      const questsCompleted = await this.quests.onEvent(tx, userId, { type: 'lesson_complete', courseId, categoryIds });
      const badgesUnlocked = await this.badges.evaluate(tx, userId);
      return { reward, questsCompleted, badgesUnlocked };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private toData(input: Partial<AiPromptInput>, partial = false): Prisma.AiPromptUncheckedCreateInput {
    const data: Record<string, unknown> = {};
    if (input.promptText !== undefined) data['promptText'] = input.promptText;
    if (input.contextText !== undefined) data['contextText'] = input.contextText;
    if (input.rubric !== undefined) data['rubricJson'] = input.rubric as unknown as Prisma.InputJsonValue;
    if (input.passThreshold !== undefined) data['passThreshold'] = input.passThreshold;
    if (input.maxAttempts !== undefined) data['maxAttempts'] = input.maxAttempts;
    if (!partial) data['rubricJson'] ??= [];
    return data as Prisma.AiPromptUncheckedCreateInput;
  }

  private async lessonWithPrompt(lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { aiPrompt: true, module: { include: { course: true } } },
    });
    if (!lesson || !lesson.aiPrompt) throw new NotFoundException('No AI prompt for this lesson');
    if (lesson.module.course.status !== 'PUBLISHED') throw new NotFoundException('Lesson not available');
    return lesson;
  }

  private async promptWithLesson(aiPromptId: string) {
    const prompt = await this.prisma.aiPrompt.findUnique({
      where: { id: aiPromptId },
      include: { lesson: { include: { module: { include: { course: true } } } } },
    });
    if (!prompt || !prompt.lesson) throw new NotFoundException('AI prompt not found');
    return { prompt, lesson: prompt.lesson };
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted) throw new ForbiddenException('Subscription required for this lesson');
  }
}

function toCriteria(json: unknown): RubricCriterion[] {
  if (!Array.isArray(json)) return [];
  return json.map((c, i) => {
    const o = c as Record<string, unknown>;
    return {
      id: typeof o['id'] === 'string' ? (o['id'] as string) : `c${i}`,
      label: typeof o['label'] === 'string' ? (o['label'] as string) : `Criterion ${i + 1}`,
      weight: typeof o['weight'] === 'number' ? (o['weight'] as number) : 1,
      kind: (o['kind'] as RubricCriterion['kind']) ?? 'keyword',
      config: (o['config'] as RubricCriterion['config']) ?? {},
    };
  });
}
