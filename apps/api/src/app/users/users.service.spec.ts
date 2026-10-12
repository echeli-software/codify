import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const row = {
  id: 'u1',
  email: 's@codify.local',
  displayName: 'S',
  role: 'STUDENT',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  marketingEmailOptIn: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  onboardedAt: null,
  lastSeenAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  totalXp: 0,
  coins: 0,
  referralCode: null,
};

function setup() {
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    user: {
      update: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
  return {
    svc: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('UsersService.update', () => {
  it('stamps onboardedAt only while it is still unset', async () => {
    const { svc, prisma } = setup();
    await svc.update('u1', { onboarded: true, displayName: 'New' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', onboardedAt: null },
      data: { onboardedAt: expect.any(Date) },
    });
    // The flag itself is not a column.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: 'New' } }),
    );
  });

  it('leaves onboardedAt alone without the flag', async () => {
    const { svc, prisma } = setup();
    await svc.update('u1', { onboarded: false, locale: 'en-US' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('UsersService.listForAdmin', () => {
  it('filters by role and searches email, name or exact id', async () => {
    const { svc, prisma } = setup();
    await svc.listForAdmin({ skip: 0, take: 20, q: ' ana ', role: 'TEACHER' });
    const where = {
      deletedAt: null,
      role: 'TEACHER',
      OR: [
        { email: { contains: 'ana', mode: 'insensitive' } },
        { displayName: { contains: 'ana', mode: 'insensitive' } },
        { id: 'ana' },
      ],
    };
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith({ where });
  });

  it('lists everyone not deleted without filters', async () => {
    const { svc, prisma } = setup();
    await svc.listForAdmin({ skip: 0, take: 20 });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });
});
