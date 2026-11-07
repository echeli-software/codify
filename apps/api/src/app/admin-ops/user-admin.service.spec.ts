import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UserAdminService } from './user-admin.service.js';
import { decodeCursor } from './admin-ops.util.js';

const item = {
  id: 'i1',
  slug: 'hat',
  name: 'Hat',
  slot: 'HAT',
  rarity: 'RARE',
  categorySlug: 'hats',
  spriteAssetId: 'emoji:🎩',
};
const owned = {
  source: 'ADMIN_GRANT',
  acquiredAt: new Date('2026-11-01'),
  item,
};

function setup() {
  const prisma = {
    user: {
      findFirst: jest.fn(async () => ({ id: 'u1' })),
      findUnique: jest.fn(async () => ({ coins: 70 })),
    },
    item: { findFirst: jest.fn(async () => ({ id: 'i1' })) },
    userItem: {
      findMany: jest.fn(async () => [owned]),
      findUnique: jest.fn(),
      create: jest.fn(async () => ({})),
    },
    equippedItem: {
      findMany: jest.fn(async () => [{ itemId: 'i1' }]),
      findFirst: jest.fn(async () => null),
    },
    coinTransaction: { findMany: jest.fn() },
    xpEvent: { findMany: jest.fn(), aggregate: jest.fn() },
  };
  return {
    svc: new UserAdminService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('UserAdminService inventory', () => {
  it('lists items with the equipped flag', async () => {
    const { svc } = setup();
    expect(await svc.inventory('u1')).toEqual([
      {
        itemId: 'i1',
        slug: 'hat',
        name: 'Hat',
        slot: 'HAT',
        rarity: 'RARE',
        categorySlug: 'hats',
        spriteAssetId: 'emoji:🎩',
        source: 'ADMIN_GRANT',
        acquiredAt: '2026-11-01T00:00:00.000Z',
        equipped: true,
      },
    ]);
  });

  it('404s unknown users', async () => {
    const { svc, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.inventory('nope')).rejects.toThrow('User not found');
  });

  it('grants with ADMIN_GRANT', async () => {
    const { svc, prisma } = setup();
    prisma.userItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(owned);
    const res = await svc.grantItem('u1', 'i1');
    expect(prisma.userItem.create).toHaveBeenCalledWith({
      data: { userId: 'u1', itemId: 'i1', source: 'ADMIN_GRANT' },
    });
    expect(res.alreadyOwned).toBe(false);
    expect(res.entry.itemId).toBe('i1');
  });

  it('is idempotent when already owned', async () => {
    const { svc, prisma } = setup();
    prisma.userItem.findUnique.mockResolvedValueOnce({
      ...owned,
      source: 'PURCHASE',
    });
    const res = await svc.grantItem('u1', 'i1');
    expect(prisma.userItem.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      alreadyOwned: true,
      entry: { source: 'PURCHASE' },
    });
  });

  it('resolves a concurrent duplicate grant as already owned', async () => {
    const { svc, prisma } = setup();
    prisma.userItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(owned);
    prisma.userItem.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    expect((await svc.grantItem('u1', 'i1')).alreadyOwned).toBe(true);
  });

  it('404s deleted/unknown items', async () => {
    const { svc, prisma } = setup();
    prisma.item.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.grantItem('u1', 'gone')).rejects.toMatchObject({
      response: { code: 'ITEM_NOT_FOUND' },
    });
  });
});

describe('UserAdminService ledger', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s));

  it('coins: stored balanceAfter + next cursor', async () => {
    const { svc, prisma } = setup();
    prisma.coinTransaction.findMany.mockResolvedValueOnce([
      {
        id: 'c3',
        createdAt: at(3),
        delta: -30,
        balanceAfter: 70,
        source: 'ITEM_PURCHASE',
        multiplier: null,
        refType: null,
        refId: null,
      },
      {
        id: 'c2',
        createdAt: at(2),
        delta: 50,
        balanceAfter: 100,
        source: 'ADMIN_GRANT',
        multiplier: null,
        refType: null,
        refId: null,
      },
      {
        id: 'c1',
        createdAt: at(1),
        delta: 50,
        balanceAfter: 50,
        source: 'LESSON_COMPLETE',
        multiplier: null,
        refType: null,
        refId: null,
      },
    ]);
    const page = await svc.ledger('u1', 'coins', undefined, 2);
    expect(page.balance).toBe(70);
    expect(page.items.map((i) => [i.delta, i.balanceAfter])).toEqual([
      [-30, 70],
      [50, 100],
    ]);
    expect(decodeCursor(page.nextCursor!)).toEqual({
      createdAt: at(2),
      id: 'c2',
    });
  });

  it('xp: balanceAfter is the running journal sum', async () => {
    const { svc, prisma } = setup();
    prisma.xpEvent.findMany.mockResolvedValueOnce([
      {
        id: 'x3',
        createdAt: at(3),
        amount: 10,
        source: 'LESSON_COMPLETE',
        multiplier: new Prisma.Decimal(1),
        refType: null,
        refId: null,
      },
      {
        id: 'x2',
        createdAt: at(2),
        amount: 20,
        source: 'DAILY_QUEST',
        multiplier: new Prisma.Decimal(2),
        refType: null,
        refId: null,
      },
    ]);
    prisma.xpEvent.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 130 } }) // all-time
      .mockResolvedValueOnce({ _sum: { amount: 100 } }); // up to x3
    const page = await svc.ledger('u1', 'xp', undefined, 25);
    expect(page.balance).toBe(130);
    expect(
      page.items.map((i) => [i.delta, i.balanceAfter, i.multiplier]),
    ).toEqual([
      [10, 100, '1'],
      [20, 90, '2'],
    ]);
    expect(page.nextCursor).toBeNull();
    expect(prisma.xpEvent.aggregate).toHaveBeenLastCalledWith({
      where: {
        userId: 'u1',
        OR: [
          { createdAt: { lt: at(3) } },
          { createdAt: at(3), id: { lte: 'x3' } },
        ],
      },
      _sum: { amount: true },
    });
  });
});
