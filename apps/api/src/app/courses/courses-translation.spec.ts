import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ContentLocalizer } from '../translations/content-localizer.service.js';
import { runInTranslationContext } from '../translations/translation-context.js';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';

const student: ApiUser = {
  userId: 's1',
  clerkId: 'c',
  email: 'e',
  role: 'STUDENT',
  displayName: 'd',
};

function course(id: string, sourceLocale = 'pt-BR') {
  return {
    id,
    slug: id,
    status: 'PUBLISHED',
    sourceLocale,
    difficulty: 1,
    estimatedMinutes: 10,
    isCapstone: false,
    coverAssetId: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    authorId: 'a1',
    author: { displayName: 'A' },
    categories: [],
    _count: { modules: 0 },
  };
}

function tr(
  entityId: string,
  locale: string,
  field: string,
  value: string,
  entityType = 'COURSE',
) {
  return { entityType, entityId, locale, field, value, outdated: false };
}

/** c1 is translated to en-US; c2 has only its pt-BR source. */
const TRANSLATIONS = [
  tr('c1', 'pt-BR', 'title', 'Sinais'),
  tr('c1', 'en-US', 'title', 'Signals'),
  tr('c2', 'pt-BR', 'title', 'Laços'),
];

function listSetup() {
  const courses = [course('c1'), course('c2')];
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    course: {
      findMany: jest.fn(
        async (args: {
          select?: unknown;
          where: { AND?: { id?: { in: string[] } }[] };
        }) => {
          if (args.select)
            return courses.map((c) => ({
              id: c.id,
              sourceLocale: c.sourceLocale,
            }));
          const ids = args.where.AND?.find((a) => a.id)?.id?.in;
          return ids ? courses.filter((c) => ids.includes(c.id)) : courses;
        },
      ),
      count: jest.fn(async () => 2),
    },
    contentTranslation: {
      findMany: jest.fn(
        async (args: { where: { entityId: { in: string[] } } }) =>
          TRANSLATIONS.filter((t) =>
            args.where.entityId.in.includes(t.entityId),
          ),
      ),
    },
    module: { findMany: jest.fn(async () => []) },
    lesson: { groupBy: jest.fn(async () => []) },
    asset: { findMany: jest.fn(async () => []) },
  };
  return {
    prisma,
    svc: new CoursesService(prisma as unknown as PrismaService),
  };
}

describe('GET /courses translation metadata (docs/11 §3)', () => {
  it('reports `_translation` per item and notes the fallback', async () => {
    const { svc } = listSetup();
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.list(student, {}, 'en-US');
      expect(res.items.map((i) => [i.title, i._translation])).toEqual([
        ['Signals', { locale: 'en-US', source: 'en-US', fallback: false }],
        ['Laços', { locale: 'en-US', source: 'pt-BR', fallback: true }],
      ]);
      return c;
    });
    expect(ctx.fallbackFrom).toBe('pt-BR');
  });

  it('source-locale callers never fall back', async () => {
    const { svc } = listSetup();
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.list(student, {}, 'pt-BR');
      expect(res.items.every((i) => i._translation?.fallback === false)).toBe(
        true,
      );
      return c;
    });
    expect(ctx.fallbackFrom).toBeNull();
  });

  it('?fallback=false keeps only courses readable in the locale', async () => {
    const { svc, prisma } = listSetup();
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.list(student, { fallback: 'false' }, 'en-US');
      expect(res.items.map((i) => i.id)).toEqual(['c1']);
      return c;
    });
    expect(ctx.fallbackFrom).toBeNull();
    // The filter is part of the paged query (and the count), not a
    // post-filter of one page.
    const paged = prisma.course.findMany.mock.calls[1]?.[0];
    expect(paged?.where.AND).toContainEqual({ id: { in: ['c1'] } });
    expect(prisma.course.count).toHaveBeenCalledWith({ where: paged?.where });
  });
});

describe('GET /courses/:idOrSlug translation metadata (docs/11 §3)', () => {
  function detailSetup(rows: ReturnType<typeof tr>[]) {
    const prisma = {
      course: {
        findFirst: jest.fn(async () => ({
          ...course('c1'),
          modules: [
            {
              id: 'm1',
              order: 0,
              lessons: [
                {
                  id: 'l1',
                  order: 0,
                  type: 'READING',
                  isFree: true,
                  estimatedMinutes: 5,
                },
              ],
            },
          ],
        })),
      },
      contentTranslation: {
        findMany: jest.fn(async (args: { where: { entityType?: string } }) =>
          args.where.entityType === 'COURSE'
            ? rows.filter((r) => r.entityType === 'COURSE')
            : rows.filter((r) => r.entityType !== 'COURSE'),
        ),
      },
      asset: { findMany: jest.fn(async () => []) },
    };
    return new CoursesService(prisma as unknown as PrismaService);
  }

  const source = [
    tr('c1', 'pt-BR', 'title', 'Sinais'),
    tr('m1', 'pt-BR', 'title', 'Módulo', 'MODULE'),
    tr('l1', 'pt-BR', 'title', 'Aula', 'LESSON'),
  ];
  const english = [
    tr('c1', 'en-US', 'title', 'Signals'),
    tr('m1', 'en-US', 'title', 'Module', 'MODULE'),
    tr('l1', 'en-US', 'title', 'Lesson', 'LESSON'),
  ];

  it('is not a fallback when course, module and lesson titles are translated', async () => {
    const svc = detailSetup([...source, ...english]);
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.getDetail(student, 'c1', 'en-US');
      expect(res._translation).toEqual({
        locale: 'en-US',
        source: 'en-US',
        fallback: false,
      });
      return c;
    });
    expect(ctx.fallbackFrom).toBeNull();
  });

  it('a missing lesson title makes the detail a fallback', async () => {
    const svc = detailSetup([...source, ...english.slice(0, 2)]);
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.getDetail(student, 'c1', 'en-US');
      expect(res._translation).toEqual({
        locale: 'en-US',
        source: 'pt-BR',
        fallback: true,
      });
      expect(res.modules[0]?.lessons[0]?.title).toBe('Aula');
      return c;
    });
    expect(ctx.fallbackFrom).toBe('pt-BR');
  });

  it('404s TRANSLATION_NOT_AVAILABLE with ?fallback=false', async () => {
    const svc = detailSetup(source);
    const err = await runInTranslationContext(
      { query: { fallback: 'false' } } as never,
      () => svc.getDetail(student, 'c1', 'en-US').catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'TRANSLATION_NOT_AVAILABLE',
      locale: 'en-US',
    });
  });

  it('?fallback=false still serves a fully translated course', async () => {
    const svc = detailSetup([...source, ...english]);
    const res = await runInTranslationContext(
      { query: { fallback: 'false' } } as never,
      () => svc.getDetail(student, 'c1', 'en-US'),
    );
    expect(res.title).toBe('Signals');
  });
});

describe('CoursesController content locale', () => {
  it('uses the shared request locale (?locale=, Accept-Language, User.locale)', async () => {
    const list = jest.fn(async () => ({ items: [], total: 0 }));
    const getDetail = jest.fn(async () => ({}));
    const localizer = {
      requestLocale: jest.fn(async () => 'en-US'),
    } as unknown as ContentLocalizer;
    const ctrl = new CoursesController(
      { list, getDetail } as unknown as CoursesService,
      {} as AuditService,
      localizer,
    );
    await ctrl.list(student, {}, 'pt-BR');
    await ctrl.detail(student, 'c1', 'pt-BR');
    expect((list.mock.calls[0] as unknown[])[2]).toBe('en-US');
    expect((getDetail.mock.calls[0] as unknown[])[2]).toBe('en-US');
  });

  it('falls back to the first Accept-Language tag without a localizer', async () => {
    const list = jest.fn(async () => ({ items: [], total: 0 }));
    const ctrl = new CoursesController(
      { list } as unknown as CoursesService,
      {} as AuditService,
    );
    await ctrl.list(student, {}, 'en-US,en;q=0.9');
    expect((list.mock.calls[0] as unknown[])[2]).toBe('en-US');
  });
});
