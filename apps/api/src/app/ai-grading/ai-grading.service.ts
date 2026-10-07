import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AiPrompt, LessonType, Prisma } from '@prisma/client';
import {
  gradeDeterministicCriterion,
  isLlmCriterion,
  scoreRubric,
  validateRubric,
  type CriterionResult,
  type RubricCriterion,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { ProgressService } from '../progress/progress.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  assertCanManageAttached,
  lessonForAuthor,
} from '../courses/course-ownership.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import type { CompletedQuest } from '../gamification/quests.service.js';
import type { UnlockedBadge } from '../gamification/badges.service.js';
import {
  RateLimitedException,
  retryAfterSeconds,
} from '../exercises/rate-limit.js';
import { AI_GRADER, type AiGrader } from './ai-grading.provider.js';

/** docs/17: 1 submission / 3 s per prompt. docs/14 §7: 5/min and 60/day per user, across prompts. */
export const AI_SUBMIT_COOLDOWN_MS = 3000;
export const AI_PER_MINUTE_LIMIT = 5;
export const AI_PER_DAY_LIMIT = 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** AI_PROMPT or CAPSTONE. */
  lessonType: LessonType;
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
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

interface Grade {
  scorePct: number;
  passed: boolean;
  results: CriterionResult[];
  gradedBy: 'HEURISTIC' | 'LLM';
  /** False when the LLM failed and the heuristic stood in — never cache that. */
  cacheable: boolean;
}

/**
 * Cache key part: the response with only presentation-neutral normalisation
 * (Unicode NFC, line endings, trailing whitespace, outer blank space) so
 * every rubric kind — including regexes and word counts — grades the
 * normalised text exactly like the original.
 */
export function normalizeResponseForCache(response: string): string {
  return response
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

const sha256 = (s: string) =>
  createHash('sha256').update(s, 'utf8').digest('hex');

/** Everything that changes a grade: rubric, threshold and the prompt the LLM sees. */
export function rubricHash(
  prompt: Pick<
    AiPrompt,
    'rubricJson' | 'passThreshold' | 'promptText' | 'contextText'
  >,
): string {
  return sha256(
    JSON.stringify({
      rubric: prompt.rubricJson,
      passThreshold: prompt.passThreshold,
      promptText: prompt.promptText,
      contextText: prompt.contextText ?? null,
    }),
  );
}

@Injectable()
export class AiGradingService {
  private readonly log = new Logger('AiGrading');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly progress: ProgressService,
    @Inject(AI_GRADER) private readonly grader: AiGrader,
  ) {}

  // ─── Admin (ADMIN, or the TEACHER who authors the course) ─────────────

  async createForLesson(
    actor: ApiUser,
    lessonId: string,
    input: AiPromptInput,
  ): Promise<AiPrompt> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (lesson.aiPromptId)
      throw new BadRequestException('Lesson already has an AI prompt');
    this.assertValidRubric(input.rubric, input.passThreshold ?? 70);
    return this.prisma.$transaction(async (tx) => {
      const prompt = await tx.aiPrompt.create({ data: this.toData(input) });
      // CAPSTONE lessons keep their type; anything else becomes AI_PROMPT.
      const type: LessonType =
        lesson.type === 'CAPSTONE' ? 'CAPSTONE' : 'AI_PROMPT';
      await tx.lesson.update({
        where: { id: lessonId },
        data: { aiPromptId: prompt.id, type },
      });
      return prompt;
    });
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: Partial<AiPromptInput>,
  ): Promise<AiPrompt> {
    const current = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('AI prompt not found');
    await assertCanManageAttached(this.prisma, actor, { aiPromptId: id });
    this.assertValidRubric(
      patch.rubric ?? current.rubricJson,
      patch.passThreshold ?? current.passThreshold,
    );
    return this.prisma.aiPrompt.update({
      where: { id },
      data: this.toData(patch, true),
    });
  }

  async getAdmin(actor: ApiUser, id: string): Promise<AiPrompt> {
    const prompt = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('AI prompt not found');
    await assertCanManageAttached(this.prisma, actor, { aiPromptId: id });
    return prompt;
  }

  async getAdminByLesson(
    actor: ApiUser,
    lessonId: string,
  ): Promise<AiPrompt | null> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (!lesson.aiPromptId) return null;
    return this.prisma.aiPrompt.findUnique({
      where: { id: lesson.aiPromptId },
    });
  }

  /** Grade a sample response without persisting — lets admins test a rubric. */
  async preview(
    actor: ApiUser,
    id: string,
    response: string,
  ): Promise<{
    scorePct: number;
    passed: boolean;
    gradedBy: 'HEURISTIC' | 'LLM';
    results: CriterionResult[];
  }> {
    const prompt = await this.getAdmin(actor, id);
    const grade = await this.grade(prompt, response);
    return {
      scorePct: grade.scorePct,
      passed: grade.passed,
      gradedBy: grade.gradedBy,
      results: grade.results,
    };
  }

  // ─── Student ──────────────────────────────────────────────────────────

  async getForStudent(
    userId: string,
    lessonId: string,
  ): Promise<StudentAiPromptView> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: {
        aiPrompt: true,
        module: { include: { course: { select: { status: true } } } },
      },
    });
    if (
      !lesson ||
      !lesson.aiPrompt ||
      lesson.module.course.status !== 'PUBLISHED'
    )
      throw new NotFoundException('No AI prompt for this lesson');
    await this.assertAccess(userId, lessonId);
    const p = lesson.aiPrompt;
    const [passed, attempts] = await Promise.all([
      this.prisma.aiSubmission.findFirst({
        where: { userId, aiPromptId: p.id, passed: true },
        select: { id: true },
      }),
      this.prisma.aiSubmission.count({ where: { userId, aiPromptId: p.id } }),
    ]);
    return {
      id: p.id,
      lessonId,
      lessonType: lesson.type,
      promptText: p.promptText,
      contextText: p.contextText,
      passThreshold: p.passThreshold,
      maxAttempts: p.maxAttempts,
      attemptsUsed: attempts,
      alreadyPassed: !!passed,
      rubric: toCriteria(p.rubricJson).map((c) => ({
        id: c.id,
        label: c.label,
        weight: c.weight,
      })),
    };
  }

  async submit(
    userId: string,
    aiPromptId: string,
    response: string,
  ): Promise<GradeResult> {
    const prompt = await this.prisma.aiPrompt.findUnique({
      where: { id: aiPromptId },
      include: { lesson: { select: { id: true, type: true } } },
    });
    if (!prompt?.lesson) throw new NotFoundException('AI prompt not found');
    const lesson = prompt.lesson;
    await this.assertAccess(userId, lesson.id);

    await this.assertWithinRateLimits(userId, aiPromptId);

    const [totalAttempts, alreadyPassed] = await Promise.all([
      this.prisma.aiSubmission.count({ where: { userId, aiPromptId } }),
      this.prisma.aiSubmission.findFirst({
        where: { userId, aiPromptId, passed: true },
        select: { id: true },
      }),
    ]);
    if (
      prompt.maxAttempts > 0 &&
      totalAttempts >= prompt.maxAttempts &&
      !alreadyPassed
    ) {
      throw new ForbiddenException({
        code: 'NO_ATTEMPTS_LEFT',
        message: 'No attempts left for this prompt',
      });
    }

    // Cross-user cache: identical (normalised) answer to the same rubric.
    const responseHash = sha256(normalizeResponseForCache(response));
    const rHash = rubricHash(prompt);
    const hit = await this.prisma.aiGradeCache.findUnique({
      where: {
        aiPromptId_responseHash_rubricHash: {
          aiPromptId,
          responseHash,
          rubricHash: rHash,
        },
      },
    });

    let grade: Grade;
    let cached = false;
    if (hit) {
      grade = {
        scorePct: hit.scorePct,
        passed: hit.passed,
        results: (hit.breakdownJson as unknown as CriterionResult[]) ?? [],
        gradedBy: hit.gradedBy,
        cacheable: false,
      };
      cached = true;
    } else {
      grade = await this.grade(prompt, response);
      if (grade.cacheable) {
        await this.prisma.aiGradeCache
          .createMany({
            data: [
              {
                aiPromptId,
                responseHash,
                rubricHash: rHash,
                scorePct: grade.scorePct,
                passed: grade.passed,
                breakdownJson:
                  grade.results as unknown as Prisma.InputJsonValue,
                gradedBy: grade.gradedBy,
              },
            ],
            skipDuplicates: true,
          })
          .catch((err: unknown) =>
            this.log.warn(
              `grade cache write failed: ${(err as Error).message}`,
            ),
          );
      }
    }

    // Every attempt (cache hits included) gets the user's own row — it is
    // what attempts, rate limits and "already passed" are counted from.
    const submission = await this.prisma.aiSubmission.create({
      data: {
        userId,
        aiPromptId,
        response,
        scorePct: grade.scorePct,
        passed: grade.passed,
        breakdownJson: grade.results as unknown as Prisma.InputJsonValue,
        gradedBy: grade.gradedBy,
        cached,
      },
    });

    const result: GradeResult = {
      submissionId: submission.id,
      scorePct: grade.scorePct,
      passed: grade.passed,
      gradedBy: grade.gradedBy,
      cached,
      results: grade.results,
    };

    if (grade.passed) {
      const capstone = lesson.type === 'CAPSTONE';
      const done = await this.progress.recordCompletion({
        userId,
        lessonId: lesson.id,
        xpSource: 'AI_PROMPT_PASS',
        coinSource: 'AI_PROMPT_PASS',
        refType: capstone ? 'capstone' : 'ai_prompt',
        refId: aiPromptId,
        questEvent: capstone ? 'capstone_pass' : 'ai_prompt_pass',
      });
      if (!done.alreadyCompleted) {
        result.reward = done.reward;
        result.questsCompleted = done.questsCompleted;
        result.badgesUnlocked = done.badgesUnlocked;
      }
    }
    return result;
  }

  // ─── Grading core ─────────────────────────────────────────────────────

  private async grade(prompt: AiPrompt, response: string): Promise<Grade> {
    const criteria = toCriteria(prompt.rubricJson);
    const deterministic: CriterionResult[] = [];
    const llm: RubricCriterion[] = [];
    for (const c of criteria) {
      if (isLlmCriterion(c)) llm.push(c);
      else {
        const det = gradeDeterministicCriterion(response, c);
        if (det) deterministic.push(det);
      }
    }
    const judged = llm.length
      ? await this.grader.judge(response, llm, {
          promptText: prompt.promptText,
          contextText: prompt.contextText,
        })
      : { results: [], gradedBy: 'HEURISTIC' as const, fallback: false };

    // Re-assemble in the rubric's original order; a criterion the judge
    // skipped counts as failed.
    const byId = new Map<string, CriterionResult>();
    for (const r of [...deterministic, ...judged.results]) byId.set(r.id, r);
    const results = criteria.map(
      (c) =>
        byId.get(c.id) ?? {
          id: c.id,
          label: c.label,
          weight: c.weight,
          passed: false,
          detail: 'not graded',
        },
    );

    const { scorePct, passed } = scoreRubric(results, prompt.passThreshold);
    const gradedBy: 'HEURISTIC' | 'LLM' =
      llm.length && judged.gradedBy === 'LLM' ? 'LLM' : 'HEURISTIC';
    return { scorePct, passed, results, gradedBy, cacheable: !judged.fallback };
  }

  private async assertWithinRateLimits(
    userId: string,
    aiPromptId: string,
  ): Promise<void> {
    const now = Date.now();
    const last = await this.prisma.aiSubmission.findFirst({
      where: { userId, aiPromptId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const cooldown = last
      ? retryAfterSeconds([last.createdAt], 1, AI_SUBMIT_COOLDOWN_MS, now)
      : 0;
    if (cooldown > 0)
      throw new RateLimitedException(
        'Slow down — wait a few seconds between submissions',
        cooldown,
        'AI_SUBMIT_COOLDOWN',
      );

    const recent = await this.prisma.aiSubmission.findMany({
      where: { userId, createdAt: { gte: new Date(now - DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      take: AI_PER_DAY_LIMIT,
      select: { createdAt: true },
    });
    const times = recent.map((r) => r.createdAt);
    const perMinute = retryAfterSeconds(
      times.slice(0, AI_PER_MINUTE_LIMIT),
      AI_PER_MINUTE_LIMIT,
      MINUTE_MS,
      now,
    );
    if (perMinute > 0)
      throw new RateLimitedException(
        `At most ${AI_PER_MINUTE_LIMIT} AI-graded answers per minute`,
        perMinute,
        'AI_RATE_LIMIT_MINUTE',
      );
    const perDay = retryAfterSeconds(times, AI_PER_DAY_LIMIT, DAY_MS, now);
    if (perDay > 0)
      throw new RateLimitedException(
        `Daily limit of ${AI_PER_DAY_LIMIT} AI-graded answers reached`,
        perDay,
        'AI_RATE_LIMIT_DAY',
      );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private assertValidRubric(rubric: unknown, passThreshold: number): void {
    const errors = validateRubric(rubric, passThreshold);
    if (errors.length)
      throw new BadRequestException({
        code: 'INVALID_RUBRIC',
        message: `Invalid rubric: ${errors.join('; ')}`,
        errors,
      });
  }

  private toData(
    input: Partial<AiPromptInput>,
    partial = false,
  ): Prisma.AiPromptUncheckedCreateInput {
    const data: Record<string, unknown> = {};
    if (input.promptText !== undefined) data['promptText'] = input.promptText;
    if (input.contextText !== undefined)
      data['contextText'] = input.contextText;
    if (input.rubric !== undefined)
      data['rubricJson'] = input.rubric as unknown as Prisma.InputJsonValue;
    if (input.passThreshold !== undefined)
      data['passThreshold'] = input.passThreshold;
    if (input.maxAttempts !== undefined)
      data['maxAttempts'] = input.maxAttempts;
    if (!partial) data['rubricJson'] ??= [];
    return data as Prisma.AiPromptUncheckedCreateInput;
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted)
      throw new ForbiddenException('Subscription required for this lesson');
  }
}

export function toCriteria(json: unknown): RubricCriterion[] {
  if (!Array.isArray(json)) return [];
  return json.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      id: typeof o['id'] === 'string' ? (o['id'] as string) : `c${i}`,
      label:
        typeof o['label'] === 'string'
          ? (o['label'] as string)
          : `Criterion ${i + 1}`,
      weight: typeof o['weight'] === 'number' ? (o['weight'] as number) : 1,
      // Unknown kinds are kept as-is so grading fails them closed.
      kind: o['kind'] as RubricCriterion['kind'],
      config: (o['config'] as RubricCriterion['config']) ?? {},
    };
  });
}
