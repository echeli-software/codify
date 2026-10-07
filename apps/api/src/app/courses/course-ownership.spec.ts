import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import {
  assertCanManageAttached,
  assertCanManageCourse,
  lessonForAuthor,
} from './course-ownership.js';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';

const user = (role: ApiUser['role'], userId = 'me'): ApiUser => ({
  userId,
  clerkId: 'c',
  email: 'e',
  role,
  displayName: 'd',
});

describe('course ownership helpers', () => {
  it('ADMIN manages anything; TEACHER only their own courses', () => {
    expect(() =>
      assertCanManageCourse(user('ADMIN'), { authorId: 'someone' }),
    ).not.toThrow();
    expect(() =>
      assertCanManageCourse(user('TEACHER'), { authorId: 'me' }),
    ).not.toThrow();
    expect(() =>
      assertCanManageCourse(user('TEACHER'), { authorId: 'someone' }),
    ).toThrow(/own courses/);
    expect(() =>
      assertCanManageCourse(user('STUDENT'), { authorId: 'me' }),
    ).toThrow();
    expect(() => assertCanManageCourse(user('TEACHER'), null)).toThrow();
  });

  it('lessonForAuthor 404s missing lessons and 403s foreign ones', async () => {
    const prisma = {
      lesson: {
        findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'mine'
            ? { id: 'mine', module: { course: { authorId: 'me' } } }
            : where.id === 'theirs'
              ? { id: 'theirs', module: { course: { authorId: 'x' } } }
              : null,
        ),
      },
    } as unknown as PrismaService;
    await expect(
      lessonForAuthor(prisma, user('TEACHER'), 'mine'),
    ).resolves.toMatchObject({ id: 'mine' });
    await expect(
      lessonForAuthor(prisma, user('TEACHER'), 'theirs'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      lessonForAuthor(prisma, user('TEACHER'), 'nope'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('attached entities without a lesson are ADMIN-only', async () => {
    const prisma = {
      lesson: { findFirst: jest.fn(async () => null) },
    } as unknown as PrismaService;
    await expect(
      assertCanManageAttached(prisma, user('TEACHER'), {
        exerciseId: 'orphan',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      assertCanManageAttached(prisma, user('ADMIN'), { exerciseId: 'orphan' }),
    ).resolves.toBeUndefined();
  });
});

describe('CoursesService.getDetail visibility', () => {
  function service(status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    const prisma = {
      course: {
        findFirst: jest.fn(async () => ({
          id: 'c1',
          slug: 's',
          status,
          sourceLocale: 'en',
          difficulty: 1,
          estimatedMinutes: 10,
          isCapstone: false,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          author: { displayName: 'A' },
          categories: [],
          modules: [],
        })),
      },
      contentTranslation: { findMany: jest.fn(async () => []) },
    };
    return new CoursesService(prisma as unknown as PrismaService);
  }

  it.each(['DRAFT', 'ARCHIVED'] as const)(
    '404s a %s course for students',
    async (status) => {
      await expect(
        service(status).getDetail(user('STUDENT'), 'c1', 'en'),
      ).rejects.toMatchObject({ status: 404 });
    },
  );
  it('shows drafts to staff and published courses to students', async () => {
    await expect(
      service('DRAFT').getDetail(user('TEACHER'), 'c1', 'en'),
    ).resolves.toMatchObject({ id: 'c1' });
    await expect(
      service('PUBLISHED').getDetail(user('STUDENT'), 'c1', 'en'),
    ).resolves.toMatchObject({ id: 'c1' });
  });
});

describe('CoursesController.list scoping', () => {
  it('always scopes a TEACHER to their own authorId, ignoring a foreign one', async () => {
    const list = jest.fn(async () => ({ items: [], total: 0 }));
    const ctrl = new CoursesController(
      { list } as unknown as CoursesService,
      {} as AuditService,
    );
    await ctrl.list(user('TEACHER'), { authorId: 'someone-else' }, undefined);
    await ctrl.list(user('TEACHER'), {}, undefined);
    await ctrl.list(user('ADMIN'), { authorId: 'someone-else' }, undefined);
    expect(list.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { authorId: 'me' },
      { authorId: 'me' },
      { authorId: 'someone-else' },
    ]);
  });
});
