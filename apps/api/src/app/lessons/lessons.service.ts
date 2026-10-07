import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Course, Module as PrismaModule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  CreateLessonDto,
  LessonResponse,
  UpdateLessonDto,
} from './lessons.dto.js';

/** Empty Tiptap doc — same shape `lesson-schema/emptyLessonDoc()` emits. */
const EMPTY_DOC: unknown = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
  version: 1,
};

@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: ApiUser,
    moduleId: string,
    input: CreateLessonDto,
  ): Promise<LessonResponse> {
    const { course, module: parent } = await this.requireModuleAccess(
      actor,
      moduleId,
      'write',
    );
    const order = input.order ?? (await this.nextOrder(parent.id));

    const created = await this.prisma.$transaction(async (tx) => {
      const collision = await tx.lesson.findUnique({
        where: { moduleId_order: { moduleId: parent.id, order } },
      });
      if (collision) throw new ConflictException(`Lesson order ${order} taken`);

      const lesson = await tx.lesson.create({
        data: {
          moduleId: parent.id,
          order,
          type: input.type ?? 'READING',
          isFree: input.isFree ?? false,
          estimatedMinutes: input.estimatedMinutes ?? 5,
          baseXp: input.baseXp ?? 10,
          baseCoins: input.baseCoins ?? 5,
          contentJson: EMPTY_DOC as Prisma.InputJsonValue,
        },
      });
      await tx.contentTranslation.create({
        data: {
          entityType: 'LESSON',
          entityId: lesson.id,
          locale: course.sourceLocale,
          field: 'title',
          value: input.title,
        },
      });
      return lesson;
    });

    return this.byId(actor, created.id);
  }

  async getById(actor: ApiUser, id: string): Promise<LessonResponse> {
    return this.byId(actor, id);
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: UpdateLessonDto,
  ): Promise<LessonResponse> {
    const target = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!target) throw new NotFoundException('Lesson not found');
    await this.requireModuleAccess(actor, target.moduleId, 'write');

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.LessonUpdateInput = {};
      if (patch.type !== undefined) data.type = patch.type;
      if (patch.isFree !== undefined) data.isFree = patch.isFree;
      if (patch.estimatedMinutes !== undefined)
        data.estimatedMinutes = patch.estimatedMinutes;
      if (patch.baseXp !== undefined) data.baseXp = patch.baseXp;
      if (patch.baseCoins !== undefined) data.baseCoins = patch.baseCoins;
      if (patch.contentJson !== undefined)
        data.contentJson = patch.contentJson as Prisma.InputJsonValue;

      if (typeof patch.order === 'number' && patch.order !== target.order) {
        const collision = await tx.lesson.findUnique({
          where: {
            moduleId_order: { moduleId: target.moduleId, order: patch.order },
          },
        });
        if (collision)
          throw new ConflictException(`Lesson order ${patch.order} taken`);
        data.order = patch.order;
      }

      if (Object.keys(data).length > 0) {
        await tx.lesson.update({ where: { id }, data });
      }

      if (patch.title !== undefined) {
        await tx.contentTranslation.upsert({
          where: {
            entityType_entityId_locale_field: {
              entityType: 'LESSON',
              entityId: id,
              locale: target.module.course.sourceLocale,
              field: 'title',
            },
          },
          update: { value: patch.title, outdated: false },
          create: {
            entityType: 'LESSON',
            entityId: id,
            locale: target.module.course.sourceLocale,
            field: 'title',
            value: patch.title,
          },
        });
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'LESSON',
            entityId: id,
            field: 'title',
            locale: { not: target.module.course.sourceLocale },
          },
          data: { outdated: true },
        });
      }
    });

    return this.byId(actor, id);
  }

  async softDelete(actor: ApiUser, id: string): Promise<void> {
    const target = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: true },
    });
    if (!target) throw new NotFoundException('Lesson not found');
    await this.requireModuleAccess(actor, target.moduleId, 'write');
    await this.prisma.lesson.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async byId(actor: ApiUser, id: string): Promise<LessonResponse> {
    const l = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!l) throw new NotFoundException('Lesson not found');
    if (actor.role === 'STUDENT' && l.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }
    const titleRow = await this.prisma.contentTranslation.findUnique({
      where: {
        entityType_entityId_locale_field: {
          entityType: 'LESSON',
          entityId: id,
          locale: l.module.course.sourceLocale,
          field: 'title',
        },
      },
    });
    return {
      id: l.id,
      moduleId: l.moduleId,
      courseId: l.module.courseId,
      order: l.order,
      type: l.type,
      isFree: l.isFree,
      estimatedMinutes: l.estimatedMinutes,
      baseXp: l.baseXp,
      baseCoins: l.baseCoins,
      title: titleRow?.value ?? `Lesson ${l.order + 1}`,
      contentJson: l.contentJson,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  private async nextOrder(moduleId: string): Promise<number> {
    const top = await this.prisma.lesson.findFirst({
      where: { moduleId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (top?.order ?? -1) + 1;
  }

  private async requireModuleAccess(
    actor: ApiUser,
    moduleId: string,
    mode: 'read' | 'write',
  ): Promise<{ module: PrismaModule; course: Course }> {
    const m = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });
    if (!m) throw new NotFoundException('Module not found');
    if (m.course.deletedAt) throw new NotFoundException('Course not found');
    if (mode === 'write') {
      if (actor.role !== 'ADMIN' && actor.role !== 'TEACHER') {
        throw new ForbiddenException('Only ADMIN/TEACHER can edit lessons');
      }
      if (actor.role === 'TEACHER' && m.course.authorId !== actor.userId) {
        throw new ForbiddenException(
          'Teachers can only edit their own courses',
        );
      }
    } else if (actor.role === 'STUDENT' && m.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Module not found');
    }
    return { module: m, course: m.course };
  }
}
