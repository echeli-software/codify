import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ItemsService, dropCopy } from './items.service.js';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  slug: 'hat',
  name: 'Top Hat',
  description: null,
  slot: 'HAT',
  categorySlug: 'hats',
  rarity: 'RARE',
  costCoins: 50,
  requiredLevel: 1,
  isPremiumOnly: false,
  isLimitedDrop: false,
  dropStartsAt: null,
  dropEndsAt: null,
  spriteAssetId: 'emoji:🎩',
  thumbnailAssetId: null,
  isActive: true,
  deletedAt: null,
  ...over,
});

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'x',
  });

function setup() {
  const tx = {
    userItem: { create: jest.fn(async () => ({})) },
    equippedItem: { upsert: jest.fn(async () => ({})) },
  };
  const prisma = {
    item: {
      findFirst: jest.fn(async () => item() as unknown),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ coins: 100, totalXp: 0 })),
      findMany: jest.fn(async () => [{ id: 'u1' }, { id: 'u2' }]),
    },
    subscription: { findMany: jest.fn(async () => []) },
    userItem: { findUnique: jest.fn(async () => null) },
    idempotencyRecord: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const gamification = {
    spendCoins: jest.fn(async () => ({ coins: 50, spent: 50 })),
  };
  const push = { sendToUser: jest.fn(async () => ({ sent: 1 })) };
  const svc = new ItemsService(
    prisma as never,
    gamification as never,
    push as never,
  );
  return { svc, prisma, tx, gamification, push };
}

describe('ItemsService.purchase', () => {
  it('equips atomically in the purchase transaction when asked', async () => {
    const { svc, tx } = setup();
    const res = await svc.purchase('u1', 'i1', { equip: true });
    expect(res).toEqual(expect.objectContaining({ coins: 50, equipped: true }));
    expect(tx.equippedItem.upsert).toHaveBeenCalledWith({
      where: { userId_slot: { userId: 'u1', slot: 'HAT' } },
      create: { userId: 'u1', slot: 'HAT', itemId: 'i1' },
      update: { itemId: 'i1' },
    });
  });

  it('does not equip by default', async () => {
    const { svc, tx } = setup();
    const res = await svc.purchase('u1', 'i1');
    expect(res.equipped).toBe(false);
    expect(tx.equippedItem.upsert).not.toHaveBeenCalled();
  });

  it('a lost race on the same item is a 409, not a 500', async () => {
    const { svc, tx } = setup();
    tx.userItem.create.mockRejectedValueOnce(uniqueError());
    await expect(
      svc.purchase('u1', 'i1', { equip: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.equippedItem.upsert).not.toHaveBeenCalled();
  });
});

describe('ItemsService admin drop validation', () => {
  it('rejects a drop window that ends before it starts', async () => {
    const { svc, prisma } = setup();
    prisma.item.findFirst.mockResolvedValueOnce(
      item({
        isLimitedDrop: true,
        dropStartsAt: new Date('2026-10-10T00:00:00Z'),
      }),
    );
    await expect(
      svc.updateItem('i1', { dropEndsAt: '2026-10-09T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ItemsService.announceDrops', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('announces each live drop once to the active audience', async () => {
    const { svc, prisma, push } = setup();
    prisma.item.findMany.mockResolvedValue([
      item({
        isLimitedDrop: true,
        dropStartsAt: new Date('2026-10-07T11:50:00Z'),
      }),
    ]);
    const first = await svc.announceDrops(now);
    expect(first).toEqual({ drops: 1, pushed: 2 });
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith({
      data: { key: 'item_drop:i1', scope: 'item_drop' },
    });
    expect(push.sendToUser).toHaveBeenCalledTimes(2);

    prisma.idempotencyRecord.create.mockRejectedValueOnce(uniqueError());
    const second = await svc.announceDrops(now);
    expect(second).toEqual({ drops: 0, pushed: 0 });
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('only looks at drops that started within the lookback window', async () => {
    const { svc, prisma } = setup();
    await svc.announceDrops(now);
    const where = (
      prisma.item.findMany.mock.calls[0] as unknown as [
        { where: { dropStartsAt: { lte: Date; gt: Date } } },
      ]
    )[0].where;
    expect(where.dropStartsAt.lte).toEqual(now);
    expect(now.getTime() - where.dropStartsAt.gt.getTime()).toBe(
      24 * 3600 * 1000,
    );
  });

  it('copy is localized', () => {
    expect(
      dropCopy('pt-BR', { id: 'i1', name: 'Hat', dropEndsAt: null }).title,
    ).toContain('Novo item');
    expect(
      dropCopy('en-US', { id: 'i1', name: 'Hat', dropEndsAt: new Date() }).body,
    ).toContain('limited time');
  });
});
