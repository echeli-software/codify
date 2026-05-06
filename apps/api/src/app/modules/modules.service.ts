import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Course, Module as PrismaModule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type { CreateModuleDto, ModuleResponse, UpdateModuleDto } from './modules.dto.js';

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
      where: { courseId: course.id },
      orderBy: { order: 'asc' },
      include: { _count: { select: { lessons: true } } },
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
    const target = await this.prisma.module.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!target) throw new NotFoundException('Module not found');
    await this.requireCourseAccess(actor, target.courseId, 'write');

    await this.prisma.$transaction(async (tx) => {
      if (typeof patch.order === 'number' && patch.order !== target.order) {
        const collision = await tx.module.findUnique({
          where: { courseId_order: { courseId: target.courseId, order: patch.order } },
        });
        if (collision) throw new ConflictException(`Module order ${patch.order} taken`);
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

  async remove(actor: ApiUser, id: string): Promise<void> {
    const target = await this.prisma.module.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!target) throw new NotFoundException('Module not found');
    await this.requireCourseAccess(actor, target.courseId, 'write');
    // Cascade is configured on Module → Lessons.
    await this.prisma.module.delete({ where: { id } });
  }

  private async byId(id: string, locale: string): Promise<ModuleResponse> {
    const m = await this.prisma.module.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { lessons: true } } },
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
      where: { courseId },
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
        throw new ForbiddenException('Teachers can only edit their own courses');
      }
    } else if (actor.role === 'STUDENT' && course.status !== 'PUBLISHED') {
      throw new NotFoundException('Course not found');
    }
    return course;
  }
}

