import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ModulesService } from './modules.service.js';

const user = (
  role: ApiUser['role'],
  userId = `${role.toLowerCase()}-1`,
): ApiUser => ({
  userId,
  clerkId: `c-${userId}`,
  email: `${userId}@x.dev`,
  role,
  displayName: userId,
});

const course = {
  id: 'course-1',
  authorId: 'teacher-1',
  status: 'PUBLISHED',
  sourceLocale: 'pt-BR',
  deletedAt: null,
};

function setup() {
  const tx = {
    module: {
      findFirst: jest.fn(async () => ({ order: 0 })),
      update: jest.fn(async () => ({})),
    },
    lesson: { updateMany: jest.fn(async () => ({ count: 2 })) },
  };
  const prisma = {
    course: { findFirst: jest.fn(async () => course) },
    module: {
      findFirst: jest.fn(async () => ({
        id: 'module-1',
        courseId: 'course-1',
        order: 3,
        deletedAt: null,
        course,
      })),
      findMany: jest.fn(async () => []),
      delete: jest.fn(),
    },
    contentTranslation: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return {
    svc: new ModulesService(prisma as unknown as PrismaService),
    prisma,
    tx,
  };
}

describe('ModulesService', () => {
  it('soft-deletes the module and cascades the soft delete to its lessons', async () => {
    const { svc, prisma, tx } = setup();
    await svc.remove(user('ADMIN'), 'module-1');

    expect(prisma.module.delete).not.toHaveBeenCalled();
    expect(prisma.contentTranslation.deleteMany).not.toHaveBeenCalled();
    const update = tx.module.update.mock.calls[0] as unknown as [
      { where: { id: string }; data: { deletedAt: Date; order: number } },
    ];
    expect(update[0].where).toEqual({ id: 'module-1' });
    expect(update[0].data.deletedAt).toBeInstanceOf(Date);
    // Parked below every live order so the (courseId, order) slot frees up.
    expect(update[0].data.order).toBe(-1);
    expect(tx.lesson.updateMany).toHaveBeenCalledWith({
      where: { moduleId: 'module-1', deletedAt: null },
      data: { deletedAt: update[0].data.deletedAt },
    });
  });

  it('parks below an already-parked module', async () => {
    const { svc, tx } = setup();
    tx.module.findFirst.mockResolvedValueOnce({ order: -4 });
    await svc.remove(user('ADMIN'), 'module-1');
    const update = tx.module.update.mock.calls[0] as unknown as [
      { data: { order: number } },
    ];
    expect(update[0].data.order).toBe(-5);
  });

  it('retries when a concurrent delete took the parking slot', async () => {
    const { svc, prisma, tx } = setup();
    tx.module.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await svc.remove(user('ADMIN'), 'module-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('404s an already-deleted module', async () => {
    const { svc, prisma } = setup();
    prisma.module.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.remove(user('ADMIN'), 'module-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.module.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'module-1', deletedAt: null } }),
    );
  });

  it('lists only live modules with live lesson counts', async () => {
    const { svc, prisma } = setup();
    await svc.listForCourse(user('STUDENT'), 'course-1', 'pt-BR');
    expect(prisma.module.findMany).toHaveBeenCalledWith({
      where: { courseId: 'course-1', deletedAt: null },
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { lessons: { where: { deletedAt: null } } } },
      },
    });
  });

  it('refuses to update a deleted module', async () => {
    const { svc, prisma } = setup();
    prisma.module.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      svc.update(user('ADMIN'), 'module-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
