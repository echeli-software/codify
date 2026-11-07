import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ItemsService, dropCopy } from './items.service.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import { runInTranslationContext } from '../translations/translation-context.js';

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
    asset: {
      findMany: jest.fn(
        async (_args?: unknown) => [] as { id: string; url?: string }[],
      ),
    },
    equippedItem: { findMany: jest.fn(async () => [] as unknown[]) },
    userItem: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    idempotencyRecord: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const gamification = {
    spendCoins: jest.fn(async () => ({ coins: 50, spent: 50 })),
  };
  const push = { sendToUser: jest.fn(async () => ({ sent: 1 })) };
  const access = { hasActiveSubscription: jest.fn(async () => false) };
  const svc = new ItemsService(
    prisma as never,
    gamification as never,
    push as never,
    access as never,
  );
  return { svc, prisma, tx, gamification, push, access };
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

const ASSET = '01960000-0000-7000-8000-0000000000aa';

describe('ItemsService sprite URLs', () => {
  it('resolves an uploaded sprite to Asset.url in the shop (one query)', async () => {
    const { svc, prisma } = setup();
    prisma.item.findMany.mockResolvedValueOnce([
      item({ id: 'i1', spriteAssetId: ASSET }),
      item({ id: 'i2', spriteAssetId: 'emoji:🎩' }),
    ]);
    prisma.asset.findMany.mockResolvedValueOnce([
      { id: ASSET, url: 'https://cdn.test/crown.png' },
    ]);
    const shop = await svc.shop('u1', {});
    expect(shop.find((s) => s.id === 'i1')?.spriteUrl).toBe(
      'https://cdn.test/crown.png',
    );
    expect(shop.find((s) => s.id === 'i2')?.spriteUrl).toBeNull();
    expect(prisma.asset.findMany).toHaveBeenCalledTimes(1);
  });

  it('includes spriteUrl on equipped avatar refs', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
      avatarConfig: null,
    } as never);
    prisma.equippedItem.findMany.mockResolvedValueOnce([
      {
        userId: 'u1',
        slot: 'HAT',
        itemId: 'i1',
        item: item({ spriteAssetId: ASSET }),
      },
    ]);
    prisma.asset.findMany.mockResolvedValueOnce([
      { id: ASSET, url: 'https://cdn.test/crown.png' },
    ]);
    const avatar = await svc.getAvatar('u1');
    expect(avatar.equipped.HAT?.spriteUrl).toBe('https://cdn.test/crown.png');
  });

  it('rejects an asset-id sprite that is not an uploaded, confirmed asset', async () => {
    const { svc, prisma } = setup();
    prisma.asset.findMany.mockResolvedValueOnce([]);
    await expect(
      svc.updateItem('i1', { spriteAssetId: ASSET }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ASSET] }, confirmed: true },
      select: { id: true },
    });
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

describe('ItemsService content translations (docs/11 §3)', () => {
  it('shop names, descriptions and category names follow the caller locale', async () => {
    const { prisma, gamification, push, access } = setup();
    const findMany = jest.fn(async () => [
      {
        entityType: 'ITEM',
        entityId: 'i1',
        locale: 'en-US',
        field: 'name',
        value: 'Top Hat (EN)',
      },
      {
        entityType: 'ITEM_CATEGORY',
        entityId: 'hats',
        locale: 'en-US',
        field: 'name',
        value: 'Hats',
      },
    ]);
    const localizer = new ContentLocalizer({
      contentTranslation: { findMany },
    } as never);
    const svc = new ItemsService(
      prisma as never,
      gamification as never,
      push as never,
      access as never,
      localizer,
    );
    prisma.item.findMany.mockResolvedValueOnce([
      { ...item({ id: 'i1' }), category: { name: 'Chapéus' } },
      {
        ...item({ id: 'i2', name: 'Óculos', description: 'Escuros' }),
        category: { name: 'Chapéus' },
      },
    ]);
    const ctx = await runInTranslationContext(
      { query: {}, headers: { 'accept-language': 'en-US' } } as never,
      async (c) => ({ shop: await svc.shop('u1', {}), c }),
    );
    const byId = new Map(ctx.shop.map((s) => [s.id, s]));
    expect(byId.get('i1')).toMatchObject({
      name: 'Top Hat (EN)',
      categoryName: 'Hats',
    });
    // i2 has no en-US text → source text + a fallback note for the header.
    expect(byId.get('i2')).toMatchObject({
      name: 'Óculos',
      description: 'Escuros',
    });
    expect(ctx.c.fallbackFrom).toBe('pt-BR');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('drop pushes use each recipient’s translated item name', async () => {
    const { prisma, gamification, push, access } = setup();
    const localizer = new ContentLocalizer({
      contentTranslation: {
        findMany: jest.fn(async () => [
          { entityId: 'i1', locale: 'en-US', value: 'Crown' },
        ]),
      },
    } as never);
    const svc = new ItemsService(
      prisma as never,
      gamification as never,
      push as never,
      access as never,
      localizer,
    );
    prisma.item.findMany.mockResolvedValueOnce([
      item({ isLimitedDrop: true, name: 'Coroa' }),
    ]);
    await svc.announceDrops(new Date('2026-11-07T12:00:00Z'));
    const build = (push.sendToUser.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { title: string };
    expect(build({ locale: 'en-US' }).title).toContain('Crown');
    expect(build({ locale: 'pt-BR' }).title).toContain('Coroa');
  });
});
