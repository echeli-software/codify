import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  SearchService,
  ilikePattern,
  searchableTypes,
  snippetAround,
} from './search.service.js';

const user = (role: ApiUser['role']): ApiUser => ({
  userId: `${role.toLowerCase()}-1`,
  clerkId: 'c',
  email: 'x@x',
  role,
  displayName: 'X',
});

function setup() {
  const prisma = {
    contentTranslation: {
      findMany: jest.fn(
        async (args: {
          where: { entityType?: string; entityId?: unknown };
        }) => {
          if (args.where.entityId)
            return [
              { entityId: 'c1', locale: 'pt-BR', value: 'Lógica PT' },
              { entityId: 'c1', locale: 'en-US', value: 'Logic EN' },
              { entityId: 'l1', locale: 'pt-BR', value: 'Variáveis' },
            ];
          return args.where.entityType === 'COURSE'
            ? [{ entityId: 'c1' }]
            : [{ entityId: 'l1' }];
        },
      ),
    },
    course: {
      findMany: jest.fn(async () => [
        { id: 'c1', slug: 'logic', sourceLocale: 'pt-BR' },
      ]),
    },
    lesson: {
      findMany: jest.fn(async () => [
        {
          id: 'l1',
          module: { course: { slug: 'logic', sourceLocale: 'pt-BR' } },
        },
      ]),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'u1', displayName: 'Ana', email: 'ana@x' },
      ]),
    },
    item: {
      findMany: jest.fn(async () => [{ id: 'i1', name: 'Hat', slug: 'hat' }]),
    },
    badge: {
      findMany: jest.fn(async () => [
        { id: 'b1', name: 'Logic', slug: 'logic' },
      ]),
    },
    $queryRaw: jest.fn(async () => [] as { id: string; hit: string }[]),
  };
  return {
    svc: new SearchService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('searchableTypes', () => {
  it('follows the admin section rules per role', () => {
    expect(searchableTypes('ADMIN')).toEqual({
      courses: true,
      lessons: true,
      users: true,
      items: true,
      badges: true,
    });
    expect(searchableTypes('TEACHER')).toEqual({
      courses: true,
      lessons: true,
      users: false,
      items: false,
      badges: false,
    });
    expect(searchableTypes('SUPPORT')).toEqual({
      courses: true,
      lessons: false,
      users: true,
      items: false,
      badges: false,
    });
  });
});

describe('SearchService.search', () => {
  it('rejects too-short queries', async () => {
    const { svc } = setup();
    await expect(
      svc.search(user('ADMIN'), ' a ', 'en-US'),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
    });
  });

  it('admin: every type, titles in the caller locale, case-insensitive', async () => {
    const { svc, prisma } = setup();
    const res = await svc.search(user('ADMIN'), ' Log ', 'en-US');
    expect(res.q).toBe('Log');
    expect(res.courses).toEqual([
      { type: 'course', id: 'c1', title: 'Logic EN', subtitle: 'logic' },
    ]);
    expect(res.lessons[0]).toMatchObject({
      id: 'l1',
      title: 'Variáveis',
      courseSlug: 'logic',
    });
    expect(res.users).toHaveLength(1);
    expect(res.items).toHaveLength(1);
    expect(res.badges).toHaveLength(1);
    expect(prisma.contentTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: 'COURSE',
          field: 'title',
          value: { contains: 'Log', mode: 'insensitive' },
        },
      }),
    );
    const courseWhere = (
      prisma.course.findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown>; take: number },
      ]
    )[0];
    expect(courseWhere.where).toEqual({
      deletedAt: null,
      OR: [
        { slug: { contains: 'Log', mode: 'insensitive' } },
        { id: { in: ['c1', 'Log'] } },
      ],
    });
    expect(courseWhere.take).toBe(5);
  });

  it('teacher: only own courses/lessons, no users/items/badges', async () => {
    const { svc, prisma } = setup();
    const res = await svc.search(user('TEACHER'), 'logic', 'pt-BR');
    expect(res.users).toEqual([]);
    expect(res.items).toEqual([]);
    expect(res.badges).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorId: 'teacher-1' }),
      }),
    );
    expect(prisma.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          module: {
            deletedAt: null,
            course: { deletedAt: null, authorId: 'teacher-1' },
          },
        }),
      }),
    );
  });
});

describe('deep content search (docs/06 §11)', () => {
  it('escapes ILIKE wildcards and builds a short snippet', () => {
    expect(ilikePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
    const long = `${'x '.repeat(60)}Stripe checkout ${'y '.repeat(60)}`;
    const snip = snippetAround(long, 'stripe');
    expect(snip).toContain('Stripe checkout');
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.length).toBeLessThanOrEqual(82);
    expect(snippetAround('short text', 'zz')).toBe('short text');
  });

  it('adds body-only matches after title matches, with a snippet subtitle', async () => {
    const { svc, prisma } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'l2', hit: 'Pay with Stripe Checkout' },
      { id: 'l1', hit: 'Also mentions stripe' },
    ]);
    prisma.lesson.findMany.mockResolvedValueOnce([
      {
        id: 'l2',
        module: { course: { slug: 'billing', sourceLocale: 'pt-BR' } },
      },
      {
        id: 'l1',
        module: { course: { slug: 'logic', sourceLocale: 'pt-BR' } },
      },
    ] as never);
    const res = await svc.search(user('ADMIN'), 'stripe', 'pt-BR');
    expect(res.lessons.map((h) => [h.id, h.match ?? 'title'])).toEqual([
      ['l1', 'title'],
      ['l2', 'content'],
    ]);
    expect(res.lessons[1].subtitle).toBe(
      'billing · “Pay with Stripe Checkout”',
    );
    const where = (
      prisma.lesson.findMany.mock.calls.at(-1) as unknown as [
        { where: { id: { in: string[] } } },
      ]
    )[0].where;
    expect(where.id.in).toEqual(expect.arrayContaining(['l1', 'l2', 'stripe']));
  });

  it('scopes the body query to the teacher’s courses and never runs it for SUPPORT', async () => {
    const { svc, prisma } = setup();
    await svc.search(user('TEACHER'), 'stripe', 'pt-BR');
    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(JSON.stringify(call)).toContain('teacher-1');
    expect(JSON.stringify(call)).toContain('%stripe%');
    prisma.$queryRaw.mockClear();
    await svc.search(user('SUPPORT'), 'stripe', 'pt-BR');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
