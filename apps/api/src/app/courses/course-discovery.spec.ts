import type { PrismaService } from '../prisma/prisma.service.js';
import {
  discoveryFilters,
  discoveryOrderBy,
  freePreviewCourseIds,
} from './course-discovery.js';

function prismaMock(opts: {
  courseTr?: { entityId: string }[];
  categories?: { id: string }[];
  categoryTr?: { entityId: string }[];
  modules?: { courseId: string }[];
}) {
  return {
    contentTranslation: {
      findMany: jest.fn(async (args: { where: { entityType: string } }) =>
        args.where.entityType === 'CATEGORY'
          ? (opts.categoryTr ?? [])
          : (opts.courseTr ?? []),
      ),
    },
    category: { findMany: jest.fn(async () => opts.categories ?? []) },
    module: { findMany: jest.fn(async () => opts.modules ?? []) },
  };
}

describe('discoveryFilters', () => {
  it('returns no clauses without discovery params', async () => {
    const prisma = prismaMock({});
    await expect(
      discoveryFilters(prisma as unknown as PrismaService, {}),
    ).resolves.toEqual([]);
    expect(prisma.contentTranslation.findMany).not.toHaveBeenCalled();
  });

  it('searches slug, translated titles and category names (escaping wildcards)', async () => {
    const prisma = prismaMock({
      courseTr: [{ entityId: 'c1' }, { entityId: 'c1' }],
      categories: [{ id: 'cat1' }],
      categoryTr: [{ entityId: 'cat2' }],
    });
    const [clause] = await discoveryFilters(
      prisma as unknown as PrismaService,
      { q: ' 100%_js ' },
    );
    expect(clause).toEqual({
      OR: [
        { slug: { contains: '100\\%\\_js', mode: 'insensitive' } },
        { id: { in: ['c1'] } },
        { categories: { some: { categoryId: { in: ['cat1', 'cat2'] } } } },
      ],
    });
  });

  it('filters by difficulty, free preview, premium-only and language', async () => {
    const prisma = prismaMock({ courseTr: [{ entityId: 'c9' }] });
    const clauses = await discoveryFilters(prisma as unknown as PrismaService, {
      difficulty: 2,
      free: 'true',
      premium: 'true',
      language: 'en-US',
    });
    expect(clauses[0]).toEqual({ difficulty: 2 });
    expect(clauses[1]).toEqual({
      modules: {
        some: {
          deletedAt: null,
          lessons: { some: { isFree: true, deletedAt: null } },
        },
      },
    });
    expect(clauses[2]).toHaveProperty('modules.none');
    expect(clauses[3]).toEqual({
      OR: [{ sourceLocale: 'en-US' }, { id: { in: ['c9'] } }],
    });
  });

  it("ignores free/premium 'false'", async () => {
    const prisma = prismaMock({});
    await expect(
      discoveryFilters(prisma as unknown as PrismaService, {
        free: 'false',
        premium: 'false',
      }),
    ).resolves.toEqual([]);
  });
});

describe('discoveryOrderBy', () => {
  it('maps each sort and keeps the default for recommended', () => {
    expect(discoveryOrderBy(undefined)).toBeNull();
    expect(discoveryOrderBy('recommended')).toBeNull();
    expect(discoveryOrderBy('popular')?.[0]).toEqual({
      enrollments: { _count: 'desc' },
    });
    expect(discoveryOrderBy('shortest')?.[0]).toEqual({
      estimatedMinutes: 'asc',
    });
    expect(discoveryOrderBy('newest')?.[0]).toEqual({
      publishedAt: { sort: 'desc', nulls: 'last' },
    });
  });
});

describe('freePreviewCourseIds', () => {
  it('collects courses with a free live lesson', async () => {
    const prisma = prismaMock({ modules: [{ courseId: 'a' }] });
    const ids = await freePreviewCourseIds(prisma as unknown as PrismaService, [
      'a',
      'b',
    ]);
    expect([...ids]).toEqual(['a']);
    await expect(
      freePreviewCourseIds(prisma as unknown as PrismaService, []),
    ).resolves.toEqual(new Set());
  });
});
