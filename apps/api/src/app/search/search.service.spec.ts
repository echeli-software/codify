import type { PrismaService } from '../prisma/prisma.service.js';
import { SearchService } from './search.service.js';

describe('SearchService', () => {
  function setup() {
    const prisma = {
      contentTranslation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { entityType: 'COURSE', entityId: 'c1' },
            { entityType: 'LESSON', entityId: 'l1' },
          ])
          .mockResolvedValueOnce([
            {
              entityType: 'COURSE',
              entityId: 'c1',
              locale: 'pt-BR',
              value: 'Curso React',
            },
            {
              entityType: 'COURSE',
              entityId: 'c1',
              locale: 'en-US',
              value: 'React course',
            },
            {
              entityType: 'LESSON',
              entityId: 'l1',
              locale: 'pt-BR',
              value: 'Hooks',
            },
          ]),
      },
      course: {
        findMany: jest.fn(async () => [
          { id: 'c1', slug: 'react', sourceLocale: 'pt-BR' },
        ]),
      },
      lesson: {
        findMany: jest.fn(async () => [
          {
            id: 'l1',
            type: 'READING',
            isFree: true,
            module: {
              course: { id: 'c1', slug: 'react', sourceLocale: 'pt-BR' },
            },
          },
        ]),
      },
    };
    return {
      svc: new SearchService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it('finds published courses and lessons, titled in the caller locale', async () => {
    const { svc, prisma } = setup();
    const res = await svc.search('rea', 'en-US');
    expect(res.courses).toEqual([
      { id: 'c1', slug: 'react', title: 'React course' },
    ]);
    expect(res.lessons[0]).toMatchObject({
      id: 'l1',
      title: 'Hooks',
      courseSlug: 'react',
      courseTitle: 'React course',
    });
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PUBLISHED',
          deletedAt: null,
        }),
      }),
    );
  });

  it('ignores one-character queries', async () => {
    const { svc, prisma } = setup();
    await expect(svc.search(' a ', 'pt-BR')).resolves.toEqual({
      courses: [],
      lessons: [],
    });
    expect(prisma.contentTranslation.findMany).not.toHaveBeenCalled();
  });
});
