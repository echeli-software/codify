import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { assertCanManageCourse } from './course-ownership.js';
import {
  PARKED_ORDER_BASE,
  copyTitle,
  validateCurriculumOrder,
  type DesiredModule,
} from './curriculum.logic.js';

type Tx = Prisma.TransactionClient;

/** Every column of `row` except its identity and timestamps (deep copy). */
function copyable<T extends { id: string; createdAt: Date; updatedAt: Date }>(
  row: T,
): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const out: Partial<T> = { ...row };
  delete out.id;
  delete out.createdAt;
  delete out.updatedAt;
  return out as Omit<T, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface CurriculumOrderResult {
  modules: { id: string; order: number; lessonIds: string[] }[];
}

export interface DuplicateLessonResult {
  id: string;
  moduleId: string;
  order: number;
  type: string;
  isFree: boolean;
  estimatedMinutes: number;
  title: string;
  /** Companion rows deep-copied with the lesson. */
  copied: { exercise: boolean; aiPrompt: boolean; scenario: boolean };
}

export interface FreeLessonsResult {
  freeLessonIds: string[];
  /** The previous free set, for "undo" and the audit diff. */
  previousFreeLessonIds: string[];
}

/**
 * Curriculum operations of the course editor (docs/04 Course → Curriculum):
 * atomic reorder of modules and lessons (lessons may move between modules),
 * lesson duplication (deep copy) and the bulk free-lesson set. ADMIN, or a
 * TEACHER on their own course.
 */
@Injectable()
export class CurriculumService {
  constructor(private readonly prisma: PrismaService) {}

  private async course(actor: ApiUser, courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, authorId: true, sourceLocale: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    assertCanManageCourse(actor, course);
    return course;
  }

  /** Live modules + live lessons in curriculum order. */
  private async liveTree(db: Tx | PrismaService, courseId: string) {
    const modules = await db.module.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        lessons: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
          select: { id: true, isFree: true },
        },
      },
    });
    return modules;
  }

  /**
   * Rewrite module and lesson `order` values in one transaction. Orders are
   * unique per parent, so rows first move to negative temporaries, then to
   * their final 0..n-1 slots; soft-deleted rows are parked at
   * {@link PARKED_ORDER_BASE}+ so they can never collide with a live slot.
   */
  async reorder(
    actor: ApiUser,
    courseId: string,
    desired: DesiredModule[],
  ): Promise<CurriculumOrderResult> {
    await this.course(actor, courseId);
    return this.prisma.$transaction(async (tx) => {
      // Serialise concurrent reorders of the same course.
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
      const tree = await this.liveTree(tx, courseId);
      const problems = validateCurriculumOrder(
        tree.map((m) => ({ id: m.id, lessonIds: m.lessons.map((l) => l.id) })),
        desired,
      );
      if (problems.length)
        throw new BadRequestException({
          code: 'INVALID_CURRICULUM_ORDER',
          message: `Invalid curriculum order: ${problems.join('; ')}`,
          errors: problems,
        });

      const moduleIds = tree.map((m) => m.id);
      const deletedModules = await tx.module.findMany({
        where: { courseId, deletedAt: { not: null } },
        select: { id: true },
        orderBy: { order: 'asc' },
      });
      const allModuleIds = [...moduleIds, ...deletedModules.map((m) => m.id)];
      const deletedLessons = await tx.lesson.findMany({
        where: { moduleId: { in: allModuleIds }, deletedAt: { not: null } },
        select: { id: true, moduleId: true },
        orderBy: { order: 'asc' },
      });

      // Phase 1: everything that may move goes to a unique negative slot.
      let tmp = -1;
      for (const id of allModuleIds)
        await tx.module.update({ where: { id }, data: { order: tmp-- } });
      const liveLessonIds = desired.flatMap((m) => m.lessonIds);
      for (const id of [...liveLessonIds, ...deletedLessons.map((l) => l.id)])
        await tx.lesson.update({ where: { id }, data: { order: tmp-- } });

      // Phase 2: final slots.
      for (const [i, m] of desired.entries()) {
        await tx.module.update({ where: { id: m.id }, data: { order: i } });
        for (const [j, lessonId] of m.lessonIds.entries())
          await tx.lesson.update({
            where: { id: lessonId },
            data: { order: j, moduleId: m.id },
          });
      }
      for (const [i, m] of deletedModules.entries())
        await tx.module.update({
          where: { id: m.id },
          data: { order: PARKED_ORDER_BASE + i },
        });
      const parkedPerModule = new Map<string, number>();
      for (const l of deletedLessons) {
        const n = parkedPerModule.get(l.moduleId) ?? 0;
        parkedPerModule.set(l.moduleId, n + 1);
        await tx.lesson.update({
          where: { id: l.id },
          data: { order: PARKED_ORDER_BASE + n },
        });
      }
      return {
        modules: desired.map((m, i) => ({
          id: m.id,
          order: i,
          lessonIds: m.lessonIds,
        })),
      };
    });
  }

  /**
   * Deep-copy a lesson right after itself: content, settings, every LESSON
   * translation (titles get a "(copy)" suffix) and its companion exercise /
   * AI prompt / scenario as new rows. Not copied: lesson multipliers
   * (time-bound promotions), progress, submissions, attempts.
   */
  async duplicateLesson(
    actor: ApiUser,
    courseId: string,
    lessonId: string,
  ): Promise<DuplicateLessonResult> {
    const course = await this.course(actor, courseId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
      const src = await tx.lesson.findFirst({
        where: {
          id: lessonId,
          deletedAt: null,
          module: { courseId, deletedAt: null },
        },
        include: { exercise: true, aiPrompt: true, scenario: true },
      });
      if (!src) throw new NotFoundException('Lesson not found');

      let exerciseId: string | null = null;
      if (src.exercise) {
        const ex = copyable(src.exercise);
        exerciseId = (
          await tx.exercise.create({
            data: {
              ...ex,
              visibleTestsJson: ex.visibleTestsJson as Prisma.InputJsonValue,
              hiddenTestsJson: ex.hiddenTestsJson as Prisma.InputJsonValue,
            },
          })
        ).id;
      }
      let aiPromptId: string | null = null;
      if (src.aiPrompt) {
        const ai = copyable(src.aiPrompt);
        aiPromptId = (
          await tx.aiPrompt.create({
            data: { ...ai, rubricJson: ai.rubricJson as Prisma.InputJsonValue },
          })
        ).id;
      }
      let scenarioId: string | null = null;
      if (src.scenario) {
        scenarioId = (
          await tx.scenario.create({
            data: {
              graphJson: src.scenario.graphJson as Prisma.InputJsonValue,
            },
          })
        ).id;
      }

      // Soft-deleted lessons may hold slots we are about to use: park them
      // above every live order first.
      const top = await tx.lesson.findFirst({
        where: { moduleId: src.moduleId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const parked = await tx.lesson.findMany({
        where: {
          moduleId: src.moduleId,
          deletedAt: { not: null },
          order: { lt: PARKED_ORDER_BASE },
        },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      const parkBase = Math.max(PARKED_ORDER_BASE, (top?.order ?? 0) + 1);
      for (const [i, l] of parked.entries())
        await tx.lesson.update({
          where: { id: l.id },
          data: { order: parkBase + i },
        });
      // Make room right after the source: shift later live lessons by one
      // (descending, so no transient unique collision).
      const later = await tx.lesson.findMany({
        where: {
          moduleId: src.moduleId,
          deletedAt: null,
          order: { gt: src.order },
        },
        orderBy: { order: 'desc' },
        select: { id: true, order: true },
      });
      for (const l of later)
        await tx.lesson.update({
          where: { id: l.id },
          data: { order: l.order + 1 },
        });

      const copy = await tx.lesson.create({
        data: {
          moduleId: src.moduleId,
          order: src.order + 1,
          type: src.type,
          isFree: src.isFree,
          estimatedMinutes: src.estimatedMinutes,
          baseXp: src.baseXp,
          baseCoins: src.baseCoins,
          contentJson: src.contentJson as Prisma.InputJsonValue,
          exerciseId,
          aiPromptId,
          scenarioId,
        },
      });
      const translations = await tx.contentTranslation.findMany({
        where: { entityType: 'LESSON', entityId: src.id },
      });
      if (translations.length)
        await tx.contentTranslation.createMany({
          data: translations.map((t) => ({
            entityType: 'LESSON' as const,
            entityId: copy.id,
            locale: t.locale,
            field: t.field,
            value: t.field === 'title' ? copyTitle(t.value, t.locale) : t.value,
            outdated: t.outdated,
          })),
        });
      const title =
        translations.find(
          (t) => t.field === 'title' && t.locale === course.sourceLocale,
        )?.value ?? translations.find((t) => t.field === 'title')?.value;
      return {
        id: copy.id,
        moduleId: copy.moduleId,
        order: copy.order,
        type: copy.type,
        isFree: copy.isFree,
        estimatedMinutes: copy.estimatedMinutes,
        title: title
          ? copyTitle(title, course.sourceLocale)
          : copyTitle(`Lesson ${src.order + 1}`, course.sourceLocale),
        copied: {
          exercise: !!exerciseId,
          aiPrompt: !!aiPromptId,
          scenario: !!scenarioId,
        },
      };
    });
  }

  /**
   * Make exactly `lessonIds` the free lessons of the course (every other
   * live lesson becomes paid). The UI sends "the first N in curriculum
   * order" and can undo by sending `previousFreeLessonIds` back.
   */
  async setFreeLessons(
    actor: ApiUser,
    courseId: string,
    lessonIds: string[],
  ): Promise<FreeLessonsResult> {
    await this.course(actor, courseId);
    return this.prisma.$transaction(async (tx) => {
      const tree = await this.liveTree(tx, courseId);
      const all = tree.flatMap((m) => m.lessons);
      const known = new Set(all.map((l) => l.id));
      const unknown = lessonIds.filter((id) => !known.has(id));
      if (unknown.length)
        throw new BadRequestException({
          code: 'LESSON_NOT_IN_COURSE',
          message: `Not lessons of this course: ${unknown.join(', ')}`,
        });
      const want = new Set(lessonIds);
      const previous = all.filter((l) => l.isFree).map((l) => l.id);
      await tx.lesson.updateMany({
        where: {
          id: { in: all.map((l) => l.id).filter((id) => want.has(id)) },
        },
        data: { isFree: true },
      });
      await tx.lesson.updateMany({
        where: {
          id: { in: all.map((l) => l.id).filter((id) => !want.has(id)) },
        },
        data: { isFree: false },
      });
      return {
        freeLessonIds: all.map((l) => l.id).filter((id) => want.has(id)),
        previousFreeLessonIds: previous,
      };
    });
  }
}
