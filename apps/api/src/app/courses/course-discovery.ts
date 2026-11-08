import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Student catalog discovery (docs/05 Learn → Catalog): server-side search,
 * filters and sort for `GET /courses`. Kept apart from CoursesService so the
 * list query only gains a couple of lines.
 */
export const COURSE_SORTS = [
  'recommended',
  'newest',
  'popular',
  'shortest',
] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];

export interface CourseDiscoveryQuery {
  /** Free-text search over course title/description (any locale), slug and category names. */
  q?: string;
  difficulty?: number;
  /** 'true' → only courses with at least one free lesson (free preview). */
  free?: 'true' | 'false';
  /** 'true' → only courses with no free lesson (subscription required). */
  premium?: 'true' | 'false';
  /** Content language: source locale or a translated title in this locale. */
  language?: string;
  sort?: CourseSort;
}

/** A lesson that is free and still live, in a live module. */
const LIVE_FREE_LESSON: Prisma.ModuleWhereInput = {
  deletedAt: null,
  lessons: { some: { isFree: true, deletedAt: null } },
};

/** Escape LIKE wildcards — Prisma `contains` passes them through. */
function literal(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Extra AND clauses for the list `where`. Async because the polymorphic
 * ContentTranslation table has no Prisma relation to Course / Category.
 */
export async function discoveryFilters(
  prisma: PrismaService,
  query: CourseDiscoveryQuery,
): Promise<Prisma.CourseWhereInput[]> {
  const and: Prisma.CourseWhereInput[] = [];

  const q = query.q?.trim();
  if (q) {
    const needle = literal(q);
    const [courseHits, categoryHits, categoryTrHits] = await Promise.all([
      prisma.contentTranslation.findMany({
        where: {
          entityType: 'COURSE',
          field: { in: ['title', 'description'] },
          value: { contains: needle, mode: 'insensitive' },
        },
        select: { entityId: true },
        take: 500,
      }),
      prisma.category.findMany({
        where: {
          deletedAt: null,
          name: { contains: needle, mode: 'insensitive' },
        },
        select: { id: true },
        take: 100,
      }),
      prisma.contentTranslation.findMany({
        where: {
          entityType: 'CATEGORY',
          field: 'name',
          value: { contains: needle, mode: 'insensitive' },
        },
        select: { entityId: true },
        take: 100,
      }),
    ]);
    const categoryIds = [
      ...new Set([
        ...categoryHits.map((c) => c.id),
        ...categoryTrHits.map((c) => c.entityId),
      ]),
    ];
    const or: Prisma.CourseWhereInput[] = [
      { slug: { contains: needle, mode: 'insensitive' } },
    ];
    if (courseHits.length)
      or.push({ id: { in: [...new Set(courseHits.map((h) => h.entityId))] } });
    if (categoryIds.length)
      or.push({ categories: { some: { categoryId: { in: categoryIds } } } });
    and.push({ OR: or });
  }

  if (query.difficulty) and.push({ difficulty: query.difficulty });

  if (query.free === 'true') and.push({ modules: { some: LIVE_FREE_LESSON } });
  if (query.premium === 'true')
    and.push({ modules: { none: LIVE_FREE_LESSON } });

  const lang = query.language?.trim();
  if (lang) {
    const translated = await prisma.contentTranslation.findMany({
      where: {
        entityType: 'COURSE',
        field: 'title',
        locale: lang,
        value: { not: '' },
      },
      select: { entityId: true },
      take: 1000,
    });
    and.push({
      OR: [
        { sourceLocale: lang },
        ...(translated.length
          ? [{ id: { in: translated.map((t) => t.entityId) } }]
          : []),
      ],
    });
  }
  return and;
}

/** `orderBy` for a sort, or null for the list's default order. */
export function discoveryOrderBy(
  sort: CourseSort | undefined,
): Prisma.CourseOrderByWithRelationInput[] | null {
  switch (sort) {
    case 'newest':
      return [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ];
    case 'popular':
      return [{ enrollments: { _count: 'desc' } }, { updatedAt: 'desc' }];
    case 'shortest':
      return [{ estimatedMinutes: 'asc' }, { updatedAt: 'desc' }];
    default:
      return null;
  }
}

/** Ids (of `courseIds`) that have at least one free, live lesson. */
export async function freePreviewCourseIds(
  prisma: PrismaService,
  courseIds: readonly string[],
): Promise<Set<string>> {
  if (courseIds.length === 0) return new Set();
  const rows = await prisma.module.findMany({
    where: { courseId: { in: [...courseIds] }, ...LIVE_FREE_LESSON },
    select: { courseId: true },
  });
  return new Set(rows.map((r) => r.courseId));
}
