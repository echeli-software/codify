import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UserListFiltersDto } from './users.dto.js';
import { UsersService } from './users.service.js';

function setup(
  groups: { country: string | null; _count: { _all: number } }[] = [],
) {
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    user: {
      findMany: jest.fn(async () => [
        {
          id: 'u1',
          email: 'a@b.c',
          displayName: 'A',
          role: 'STUDENT',
          locale: 'pt-BR',
          lastSeenAt: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          country: 'BR',
        },
      ]),
      count: jest.fn(async () => 1),
      groupBy: jest.fn(async () => groups),
      findFirst: jest.fn(async () => null),
    },
  };
  return {
    svc: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('Users country (docs/04 Users, Phase 14)', () => {
  it('filters by an ISO country code', async () => {
    const { svc, prisma } = setup();
    const res = await svc.listForAdmin({ skip: 0, take: 20, country: 'BR' });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { deletedAt: null, country: 'BR' },
    });
    expect(res.items[0]).toMatchObject({ id: 'u1', country: 'BR' });
  });

  it('NONE matches users without a known country', async () => {
    const { svc, prisma } = setup();
    await svc.listForAdmin({ skip: 0, take: 20, country: 'NONE' });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { deletedAt: null, country: null },
    });
  });

  it('lists the countries present, most users first, unknown last', async () => {
    const { svc, prisma } = setup([
      { country: null, _count: { _all: 9 } },
      { country: 'PT', _count: { _all: 2 } },
      { country: 'BR', _count: { _all: 5 } },
      { country: 'AR', _count: { _all: 2 } },
    ]);
    const { items } = await svc.countriesForAdmin();
    expect(prisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['country'], where: { deletedAt: null } }),
    );
    expect(items).toEqual([
      { country: 'BR', users: 5 },
      { country: 'AR', users: 2 },
      { country: 'PT', users: 2 },
      { country: null, users: 9 },
    ]);
  });

  it('validates the country query param', () => {
    const errors = (country: string) =>
      validateSync(plainToInstance(UserListFiltersDto, { country }));
    expect(errors('BR')).toHaveLength(0);
    expect(errors('br')).toHaveLength(0);
    expect(errors('NONE')).toHaveLength(0);
    expect(errors('BRA')).not.toHaveLength(0);
    expect(errors('B1')).not.toHaveLength(0);
    expect(errors('')).not.toHaveLength(0);
  });
});
