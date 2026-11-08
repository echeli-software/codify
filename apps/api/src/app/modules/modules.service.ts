import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Course, Module as PrismaModule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  CreateModuleDto,
  ModuleResponse,
  UpdateModuleDto,
} from './modules.dto.js';

/** Lesson count per module, ignoring soft-deleted lessons. */
const LIVE_LESSON_COUNT = {
  _count: { select: { lessons: { where: { deletedAt: null } } } },
} as const;

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCourse(
    actor: ApiUser,
    courseId: string,
    locale: string,
  ): Promise<ModuleResponse[]> {
    const course = await this.requireCourseAccess(actor, courseId, 'read');
    const modules = await this.prisma.module.findMany({
      where: { courseId: course.id, deletedAt: null },
      orderBy: { order: 'asc' },
      include: LIVE_LESSON_COUNT,
    });
    return this.attachTitles(modules, locale, course.sourceLocale);
  }

  async create(
    actor: ApiUser,
    courseId: string,
    input: CreateModuleDto,
  ): Promise<ModuleResponse> {
    const course = await this.requireCourseAccess(actor, courseId, 'write');
    const order = input.order ?? (await this.nextOrder(course.id));

    const created = await this.prisma.$transaction(async (tx) => {
      // (courseId, order) is unique — bail early on collision.
      const collision = await tx.module.findUnique({
        where: { courseId_order: { courseId: course.id, order } },
      });
      if (collision) {
        throw new ConflictException(`Module order ${order} already taken`);
      }
      const m = await tx.module.create({
        data: { courseId: course.id, order },
      });
      await tx.contentTranslation.create({
        data: {
          entityType: 'MODULE',
          entityId: m.id,
          locale: course.sourceLocale,
          field: 'title',
          value: input.title,
        },
      });
      return m;
    });
    return this.byId(created.id, course.sourceLocale);
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: UpdateModuleDto,
  ): Promise<ModuleResponse> {
    const target = await this.prisma.module.findFirst({
      where: { id, deletedAt: null },
      include: { course: true },
    });
    if (!target) throw new NotFoundException('Module not found');
    await this.requireCourseAccess(actor, target.courseId, 'write');

    await this.prisma.$transaction(async (tx) => {
      if (typeof patch.order === 'number' && patch.order !== target.order) {
        const collision = await tx.module.findUnique({
          where: {
            courseId_order: { courseId: target.courseId, order: patch.order },
          },
        });
        if (collision)
          throw new ConflictException(`Module order ${patch.order} taken`);
        await tx.module.update({ where: { id }, data: { order: patch.order } });
      }
      if (patch.title !== undefined) {
        await tx.contentTranslation.upsert({
          where: {
            entityType_entityId_locale_field: {
              entityType: 'MODULE',
              entityId: id,
              locale: target.course.sourceLocale,
              field: 'title',
            },
          },
          update: { value: patch.title, outdated: false },
          create: {
            entityType: 'MODULE',
            entityId: id,
            locale: target.course.sourceLocale,
            field: 'title',
            value: patch.title,
          },
        });
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'MODULE',
            entityId: id,
            field: 'title',
            locale: { not: target.course.sourceLocale },
          },
          data: { outdated: true },
        });
      }
    });
    return this.byId(id, target.course.sourceLocale);
  }

  /**
   * Soft delete (docs/02 Conventions). The module and its live lessons get
   * `deletedAt`; lessons, students' Progress rows and ContentTranslation
   * rows are kept, so completions, XP history and certificates stay intact.
   * The module is parked at a negative `order` so its slot in the
   * (courseId, order) unique index is free for a new module. Every read
   * path filters `Module.deletedAt` / `Lesson.deletedAt`.
   */
  async remove(
    actor: ApiUser,
    id: string,
  ): Promise<{ courseId: string; order: number; lessonCount: number }> {
    const target = await this.prisma.module.findFirst({
      where: { id, deletedAt: null },
      include: { course: true },
    });
    if (!target) throw new NotFoundException('Module not found');
    await this.requireCourseAccess(actor, target.courseId, 'write');
    for (let attempt = 0; ; attempt++) {
      try {
        const { count } = await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const lowest = await tx.module.findFirst({
            where: { courseId: target.courseId },
            orderBy: { order: 'asc' },
            select: { order: true },
          });
          await tx.module.update({
            where: { id },
            data: {
              deletedAt: now,
              order: Math.min(lowest?.order ?? 0, 0) - 1,
            },
          });
          return tx.lesson.updateMany({
            where: { moduleId: id, deletedAt: null },
            data: { deletedAt: now },
          });
        });
        return {
          courseId: target.courseId,
          order: target.order,
          lessonCount: count,
        };
      } catch (err) {
        // Two concurrent deletes in one course can pick the same parking
        // slot; the loser retries with a fresh minimum.
        if (!isUniqueViolation(err) || attempt >= 2) throw err;
      }
    }
  }

  private async byId(id: string, locale: string): Promise<ModuleResponse> {
    const m = await this.prisma.module.findUniqueOrThrow({
      where: { id },
      include: LIVE_LESSON_COUNT,
    });
    const list = await this.attachTitles([m], locale, locale);
    if (!list[0]) throw new NotFoundException('Module not found');
    return list[0];
  }

  private async attachTitles(
    modules: (PrismaModule & { _count: { lessons: number } })[],
    locale: string,
    sourceLocale: string,
  ): Promise<ModuleResponse[]> {
    const ids = modules.map((m) => m.id);
    const translations = ids.length
      ? await this.prisma.contentTranslation.findMany({
          where: {
            entityType: 'MODULE',
            entityId: { in: ids },
            field: 'title',
          },
        })
      : [];

    return modules.map((m) => {
      const atLocale = translations.find(
        (t) => t.entityId === m.id && t.locale === locale,
      );
      const atSource = translations.find(
        (t) => t.entityId === m.id && t.locale === sourceLocale,
      );
      const title =
        atLocale?.value ?? atSource?.value ?? `Module ${m.order + 1}`;
      return {
        id: m.id,
        courseId: m.courseId,
        order: m.order,
        title,
        lessonCount: m._count.lessons,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      };
    });
  }

  private async nextOrder(courseId: string): Promise<number> {
    const top = await this.prisma.module.findFirst({
      where: { courseId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (top?.order ?? -1) + 1;
  }

  /**
   * Gate course access. Read = any authenticated user (PUBLISHED courses
   * are public to STUDENTs but the controller layer scopes to PUBLISHED).
   * Write = ADMIN | TEACHER (the latter only their own courses).
   */
  private async requireCourseAccess(
    actor: ApiUser,
    courseId: string,
    mode: 'read' | 'write',
  ): Promise<Course> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (mode === 'write') {
      if (actor.role !== 'ADMIN' && actor.role !== 'TEACHER') {
        throw new ForbiddenException('Only ADMIN/TEACHER can edit modules');
      }
      if (actor.role === 'TEACHER' && course.authorId !== actor.userId) {
        throw new ForbiddenException(
          'Teachers can only edit their own courses',
        );
      }
    } else if (actor.role === 'STUDENT' && course.status !== 'PUBLISHED') {
      throw new NotFoundException('Course not found');
    }
    return course;
  }
}
