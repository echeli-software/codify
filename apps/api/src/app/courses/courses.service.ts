import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ContentTranslation, Course, CourseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  CourseDetail,
  CourseListItem,
  CourseListResponse,
  CourseModuleSummary,
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
} from './courses.dto.js';

interface ResolvedTitle {
  title: string;
  description: string | null;
  fromTranslation: boolean;
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List with locale-aware title resolution. STUDENT callers only see
   * PUBLISHED courses; staff see everything (including drafts) but
   * TEACHERs only see their own drafts — surfaced via authorId filter
   * in the controller.
   */
  async list(
    actor: ApiUser,
    query: ListCoursesQueryDto,
    locale: string,
  ): Promise<CourseListResponse> {
    const where: Prisma.CourseWhereInput = { deletedAt: null };

    // Status filter — students are forced to PUBLISHED; staff defaults to all.
    if (actor.role === 'STUDENT') {
      where.status = 'PUBLISHED';
    } else if (query.status) {
      where.status = query.status;
    }

    // Teachers can only see their own drafts; published courses are visible
    // to all staff. The controller layer scopes authorId for TEACHERs.
    if (query.authorId) where.authorId = query.authorId;

    if (query.categoryId) {
      where.categories = { some: { categoryId: query.categoryId } };
    }

    const skip = query.skip ?? 0;
    const take = Math.min(query.take ?? 20, 200);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        skip,
        take,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        include: {
          author: { select: { displayName: true } },
          categories: { select: { categoryId: true } },
          _count: { select: { modules: true } },
        },
      }),
      this.prisma.course.count({ where }),
    ]);

    // Translations live in a polymorphic table without a Prisma relation
    // (see schema comment), so fetch them explicitly per page.
    const courseIds = rows.map((r) => r.id);
    const translations = courseIds.length
      ? await this.prisma.contentTranslation.findMany({
          where: {
            entityType: 'COURSE',
            entityId: { in: courseIds },
            field: { in: ['title', 'description'] },
          },
        })
      : [];

    // Lesson counts — lessons live under modules, not courses directly,
    // so aggregate via a 2-query pattern (modules-with-courseId, then
    // lessons groupBy moduleId). Keeps it O(2) regardless of page size.
    const courseModules = courseIds.length
      ? await this.prisma.module.findMany({
          where: { courseId: { in: courseIds } },
          select: { id: true, courseId: true },
        })
      : [];
    const moduleIdToCourseId = new Map(courseModules.map((m) => [m.id, m.courseId]));
    const lessonGroups = courseModules.length
      ? await this.prisma.lesson.groupBy({
          by: ['moduleId'],
          where: {
            deletedAt: null,
            moduleId: { in: courseModules.map((m) => m.id) },
          },
          _count: { _all: true },
        })
      : [];
    const lessonCountByCourseId = new Map<string, number>();
    for (const g of lessonGroups) {
      const cid = moduleIdToCourseId.get(g.moduleId);
      if (!cid) continue;
      lessonCountByCourseId.set(cid, (lessonCountByCourseId.get(cid) ?? 0) + g._count._all);
    }

    return {
      items: rows.map((r) =>
        toListItem(
          r,
          translations.filter((t) => t.entityId === r.id),
          locale,
          lessonCountByCourseId.get(r.id) ?? 0,
        ),
      ),
      total,
    };
  }

  async getDetail(idOrSlug: string, locale: string): Promise<CourseDetail> {
    const where = isUuid(idOrSlug)
      ? { id: idOrSlug, deletedAt: null }
      : { slug: idOrSlug, deletedAt: null };
    const course = await this.prisma.course.findFirst({
      where,
      include: {
        author: { select: { displayName: true } },
        categories: { select: { categoryId: true } },
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              where: { deletedAt: null },
              orderBy: { order: 'asc' },
              select: {
                id: true,
                order: true,
                type: true,
                isFree: true,
                estimatedMinutes: true,
              },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    const courseTranslations = await this.prisma.contentTranslation.findMany({
      where: { entityType: 'COURSE', entityId: course.id },
    });
    const moduleIds = course.modules.map((m) => m.id);
    const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
    const childTranslations = await this.prisma.contentTranslation.findMany({
      where: {
        OR: [
          moduleIds.length ? { entityType: 'MODULE', entityId: { in: moduleIds } } : undefined,
          lessonIds.length ? { entityType: 'LESSON', entityId: { in: lessonIds } } : undefined,
        ].filter(Boolean) as Prisma.ContentTranslationWhereInput[],
        field: { in: ['title'] },
      },
    });

    const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const list = toListItem(
      {
        ...course,
        _count: { modules: course.modules.length },
      } as never,
      courseTranslations,
      locale,
      totalLessons,
    );

    const modules: CourseModuleSummary[] = course.modules.map((m) => ({
      id: m.id,
      order: m.order,
      title: pickTitle(childTranslations, 'MODULE', m.id, locale, course.sourceLocale)
        ?? `Module ${m.order + 1}`,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        order: l.order,
        type: l.type,
        isFree: l.isFree,
        estimatedMinutes: l.estimatedMinutes,
        title:
          pickTitle(childTranslations, 'LESSON', l.id, locale, course.sourceLocale) ??
          `Lesson ${l.order + 1}`,
      })),
    }));

    return { ...list, modules };
  }

  async create(actor: ApiUser, input: CreateCourseDto): Promise<CourseListItem> {
    const existing = await this.prisma.course.findUnique({ where: { slug: input.slug } });
    if (existing) throw new ConflictException('Slug already in use');

    const sourceLocale = input.sourceLocale ?? 'pt-BR';
    const created = await this.prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          slug: input.slug,
          authorId: actor.userId,
          sourceLocale,
          status: 'DRAFT',
          difficulty: input.difficulty ?? 1,
          estimatedMinutes: input.estimatedMinutes ?? 60,
        },
      });
      await tx.contentTranslation.create({
        data: {
          entityType: 'COURSE',
          entityId: course.id,
          locale: sourceLocale,
          field: 'title',
          value: input.title,
        },
      });
      if (input.description !== undefined) {
        await tx.contentTranslation.create({
          data: {
            entityType: 'COURSE',
            entityId: course.id,
            locale: sourceLocale,
            field: 'description',
            value: input.description,
          },
        });
      }
      if (input.categoryIds?.length) {
        await tx.courseCategory.createMany({
          data: input.categoryIds.map((cid) => ({
            courseId: course.id,
            categoryId: cid,
          })),
        });
      }
      return course;
    });

    return this.getById(created.id, sourceLocale);
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: UpdateCourseDto,
  ): Promise<CourseListItem> {
    const target = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Course not found');
    if (actor.role === 'TEACHER' && target.authorId !== actor.userId) {
      throw new ForbiddenException('Teachers can only edit their own courses');
    }
    if (patch.slug && patch.slug !== target.slug) {
      const dupe = await this.prisma.course.findUnique({ where: { slug: patch.slug } });
      if (dupe) throw new ConflictException('Slug already in use');
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CourseUpdateInput = {};
      if (patch.slug) data.slug = patch.slug;
      if (typeof patch.difficulty === 'number') data.difficulty = patch.difficulty;
      if (typeof patch.estimatedMinutes === 'number')
        data.estimatedMinutes = patch.estimatedMinutes;
      if (typeof patch.isCapstone === 'boolean') data.isCapstone = patch.isCapstone;

      if (Object.keys(data).length > 0) {
        await tx.course.update({ where: { id }, data });
      }

      if (patch.title !== undefined) {
        await upsertTranslation(
          tx,
          'COURSE',
          id,
          target.sourceLocale,
          'title',
          patch.title,
        );
        // Mark non-source-locale title translations as outdated.
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'COURSE',
            entityId: id,
            field: 'title',
            locale: { not: target.sourceLocale },
          },
          data: { outdated: true },
        });
      }
      if (patch.description !== undefined) {
        await upsertTranslation(
          tx,
          'COURSE',
          id,
          target.sourceLocale,
          'description',
          patch.description,
        );
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'COURSE',
            entityId: id,
            field: 'description',
            locale: { not: target.sourceLocale },
          },
          data: { outdated: true },
        });
      }

      if (patch.categoryIds) {
        await tx.courseCategory.deleteMany({ where: { courseId: id } });
        if (patch.categoryIds.length) {
          await tx.courseCategory.createMany({
            data: patch.categoryIds.map((cid) => ({
              courseId: id,
              categoryId: cid,
            })),
          });
        }
      }
    });

    return this.getById(id, target.sourceLocale);
  }

  async publish(actor: ApiUser, id: string): Promise<CourseListItem> {
    const target = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Course not found');
    if (actor.role === 'TEACHER' && target.authorId !== actor.userId) {
      throw new ForbiddenException('Teachers can only publish their own courses');
    }
    if (target.status === 'PUBLISHED') {
      throw new BadRequestException('Already published');
    }
    await this.prisma.course.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: target.publishedAt ?? new Date() },
    });
    return this.getById(id, target.sourceLocale);
  }

  async archive(actor: ApiUser, id: string): Promise<CourseListItem> {
    const target = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Course not found');
    if (actor.role === 'TEACHER' && target.authorId !== actor.userId) {
      throw new ForbiddenException('Teachers can only archive their own courses');
    }
    await this.prisma.course.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return this.getById(id, target.sourceLocale);
  }

  async softDelete(actor: ApiUser, id: string): Promise<void> {
    const target = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Course not found');
    if (actor.role === 'TEACHER' && target.authorId !== actor.userId) {
      throw new ForbiddenException('Teachers can only delete their own courses');
    }
    await this.prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async getById(id: string, locale: string): Promise<CourseListItem> {
    const course = await this.prisma.course.findFirstOrThrow({
      where: { id },
      include: {
        author: { select: { displayName: true } },
        categories: { select: { categoryId: true } },
        _count: { select: { modules: true } },
      },
    });
    const translations = await this.prisma.contentTranslation.findMany({
      where: {
        entityType: 'COURSE',
        entityId: id,
        field: { in: ['title', 'description'] },
      },
    });
    const lessonCount = await this.prisma.lesson.count({
      where: { deletedAt: null, module: { courseId: id } },
    });
    return toListItem(course as never, translations, locale, lessonCount);
  }
}

type CourseWithIncludes = Course & {
  author: { displayName: string };
  categories: { categoryId: string }[];
  _count: { modules: number };
};

function toListItem(
  c: CourseWithIncludes,
  translations: ContentTranslation[],
  locale: string,
  lessonCount: number,
): CourseListItem {
  const resolved = pickTitleAndDescription(translations, locale, c.sourceLocale);
  return {
    id: c.id,
    slug: c.slug,
    status: c.status as CourseStatus,
    difficulty: c.difficulty,
    estimatedMinutes: c.estimatedMinutes,
    isCapstone: c.isCapstone,
    sourceLocale: c.sourceLocale,
    publishedAt: c.publishedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    authorDisplayName: c.author.displayName,
    title: resolved.title,
    description: resolved.description,
    titleFromTranslation: resolved.fromTranslation,
    categoryIds: c.categories.map((cc) => cc.categoryId),
    moduleCount: c._count.modules,
    lessonCount,
  };
}

function pickTitleAndDescription(
  translations: ContentTranslation[],
  locale: string,
  sourceLocale: string,
): ResolvedTitle {
  const titleAtLocale = translations.find((t) => t.field === 'title' && t.locale === locale);
  const titleAtSource = translations.find(
    (t) => t.field === 'title' && t.locale === sourceLocale,
  );
  const descAtLocale = translations.find(
    (t) => t.field === 'description' && t.locale === locale,
  );
  const descAtSource = translations.find(
    (t) => t.field === 'description' && t.locale === sourceLocale,
  );
  const title = titleAtLocale?.value ?? titleAtSource?.value ?? 'Untitled';
  const description = descAtLocale?.value ?? descAtSource?.value ?? null;
  return {
    title,
    description,
    fromTranslation: !!titleAtLocale && titleAtLocale.locale !== sourceLocale,
  };
}

function pickTitle(
  translations: ContentTranslation[],
  entityType: 'COURSE' | 'MODULE' | 'LESSON',
  entityId: string,
  locale: string,
  sourceLocale: string,
): string | null {
  const matching = translations.filter(
    (t) => t.entityType === entityType && t.entityId === entityId && t.field === 'title',
  );
  if (matching.length === 0) return null;
  const atLocale = matching.find((t) => t.locale === locale);
  if (atLocale) return atLocale.value;
  const atSource = matching.find((t) => t.locale === sourceLocale);
  return atSource?.value ?? matching[0]?.value ?? null;
}

async function upsertTranslation(
  tx: Prisma.TransactionClient,
  entityType: 'COURSE' | 'MODULE' | 'LESSON' | 'CATEGORY',
  entityId: string,
  locale: string,
  field: string,
  value: string,
): Promise<void> {
  await tx.contentTranslation.upsert({
    where: {
      entityType_entityId_locale_field: { entityType, entityId, locale, field },
    },
    update: { value, outdated: false },
    create: { entityType, entityId, locale, field, value },
  });
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
