import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_AVATAR_CONFIG } from '@codify/ui-core';
import { ItemsService } from './items.service.js';
import { StarterPetService, cleanPetName } from './starter-pet.service.js';
import {
  Day2PetPushService,
  day2Copy,
  nextDate,
} from './day2-pet-push.service.js';

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'x',
  });

function itemsSetup(stored: unknown = { skinTone: 'deep' }) {
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async () => ({
        avatarConfig: stored,
        petName: 'Byte',
      })),
      findUnique: jest.fn(async () => ({ avatarUpdatedAt: null })),
      update: jest.fn(async (args: unknown) => args),
    },
    equippedItem: {
      findMany: jest.fn(async () => [] as unknown[]),
      upsert: jest.fn((args: unknown) => ({ upsert: args })),
    },
    userItem: {
      findMany: jest.fn(async () => [] as unknown[]),
      findFirst: jest.fn(async () => null),
    },
    asset: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const svc = new ItemsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma };
}

describe('ItemsService avatar config (docs/08 §5)', () => {
  it('returns the full normalized config and the pet name', async () => {
    const { svc } = itemsSetup({ skinTone: 'deep', junk: 1 });
    const av = await svc.getAvatar('u1');
    expect(av.config).toEqual({ ...DEFAULT_AVATAR_CONFIG, skinTone: 'deep' });
    expect(av.petName).toBe('Byte');
  });

  it('merges a valid patch over the stored config', async () => {
    const { svc, prisma } = itemsSetup({ skinTone: 'deep' });
    await svc.saveConfig('u1', { baseHairStyle: 'coily', pose: 'wave' });
    const data = (
      prisma.user.update.mock.calls[0][0] as {
        data: { avatarConfig: Record<string, unknown> };
      }
    ).data;
    expect(data.avatarConfig).toEqual({
      ...DEFAULT_AVATAR_CONFIG,
      skinTone: 'deep',
      baseHairStyle: 'coily',
      pose: 'wave',
    });
  });

  it('rejects unknown keys and off-palette values with problems', async () => {
    const { svc, prisma } = itemsSetup();
    const err = await svc
      .saveConfig('u1', { skinTone: 'purple', wings: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as {
      code: string;
      errors: string[];
    };
    expect(body.code).toBe('avatar.config_invalid');
    expect(body.errors).toHaveLength(2);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('ItemsService.randomize (docs/08 §9)', () => {
  it('equips one owned item per slot and keeps the skin tone', async () => {
    const { svc, prisma } = itemsSetup({ skinTone: 'olive' });
    prisma.userItem.findMany.mockResolvedValueOnce([
      { itemId: 'h1', item: { slot: 'HAT' } },
      { itemId: 'h2', item: { slot: 'HAT' } },
      { itemId: 'p1', item: { slot: 'PET' } },
    ]);
    await svc.randomize('u1', { look: true }, () => 0.99);
    const upserts = prisma.equippedItem.upsert.mock.calls.map(
      (c) => (c[0] as { create: { slot: string; itemId: string } }).create,
    );
    expect(upserts).toEqual([
      expect.objectContaining({ slot: 'HAT', itemId: 'h2' }),
      expect.objectContaining({ slot: 'PET', itemId: 'p1' }),
    ]);
    const look = (
      prisma.user.update.mock.calls[0][0] as {
        data: { avatarConfig: Record<string, string> };
      }
    ).data.avatarConfig;
    expect(look['skinTone']).toBe('olive');
    expect(look['pose']).toBe('study');
    // EMOTE is not shuffled by default.
    const where = (
      prisma.userItem.findMany.mock.calls[0] as unknown as [
        { where: { item: { slot: { in: string[] } } } },
      ]
    )[0].where.item.slot.in;
    expect(where).not.toContain('EMOTE');
  });

  it('writes nothing when nothing is owned', async () => {
    const { svc, prisma } = itemsSetup();
    await svc.randomize('u1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function starterSetup(opts: {
  claimed?: boolean;
  lessons?: number;
  item?: unknown;
}) {
  const pet = {
    id: 'pet1',
    slug: 'starter-pet-kitten',
    name: 'Gatinho',
    description: null,
    slot: 'PET',
    categorySlug: 'starter',
    rarity: 'COMMON',
    costCoins: 0,
    requiredLevel: 1,
    isPremiumOnly: false,
    isLimitedDrop: false,
    dropStartsAt: null,
    dropEndsAt: null,
    spriteAssetId: 'emoji:🐱',
    thumbnailAssetId: null,
    isActive: false,
    deletedAt: null,
  };
  let claimed = opts.claimed ?? false;
  let named: string | null = null;
  const tx = {
    userItem: {
      create: jest.fn(async () => {
        claimed = true;
        return {};
      }),
    },
    equippedItem: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
    },
    itemCategory: { upsert: jest.fn(async () => ({})) },
    item: { create: jest.fn(async () => pet) },
    contentTranslation: { createMany: jest.fn(async () => ({ count: 2 })) },
  };
  const prisma = {
    userItem: {
      findFirst: jest.fn(async () =>
        claimed ? { item: pet, nickname: named } : null,
      ),
      updateMany: jest.fn((args: unknown) => {
        named = (args as { data: { nickname: string } }).data.nickname;
        return { userItem: args };
      }),
    },
    progress: { count: jest.fn(async () => opts.lessons ?? 1) },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ petName: null })),
      update: jest.fn((args: unknown) => ({ user: args })),
    },
    item: {
      findUnique: jest.fn(async () =>
        opts.item === undefined ? pet : opts.item,
      ),
    },
    asset: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : arg,
    ),
  };
  const items = {
    getAvatar: jest.fn(async () => ({ config: {}, equipped: {} })),
  };
  const svc = new StarterPetService(prisma as never, items as never);
  return { svc, prisma, tx, pet };
}

describe('StarterPetService (docs/10 §2 first reward)', () => {
  it('is locked until the first lesson is completed', async () => {
    const { svc } = starterSetup({ lessons: 0 });
    await expect(svc.status('u1')).resolves.toEqual(
      expect.objectContaining({ claimed: false, eligible: false }),
    );
    await expect(svc.claim('u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('gives the pet once with source ONBOARDING, equips and names it', async () => {
    const { svc, tx, prisma } = starterSetup({});
    const res = await svc.claim('u1', { petName: '  Bit   Byte ' });
    expect(tx.userItem.create).toHaveBeenCalledWith({
      data: { userId: 'u1', itemId: 'pet1', source: 'ONBOARDING' },
    });
    expect(tx.equippedItem.create).toHaveBeenCalledWith({
      data: { userId: 'u1', slot: 'PET', itemId: 'pet1' },
    });
    // The gift's own name, mirrored to the legacy User.petName.
    expect(prisma.userItem.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', source: 'ONBOARDING', item: { slot: 'PET' } },
      data: { nickname: 'Bit Byte' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { petName: 'Bit Byte' },
    });
    expect(res.petName).toBe('Bit Byte');
    expect(res.alreadyClaimed).toBe(false);
    expect(res.claimed).toBe(true);
    // Idempotent second call.
    const again = await svc.claim('u1');
    expect(again.alreadyClaimed).toBe(true);
    expect(tx.userItem.create).toHaveBeenCalledTimes(1);
  });

  it('does not replace a pet that is already equipped', async () => {
    const { svc, tx } = starterSetup({});
    tx.equippedItem.findUnique.mockResolvedValueOnce({
      itemId: 'other',
    } as never);
    await svc.claim('u1');
    expect(tx.equippedItem.create).not.toHaveBeenCalled();
  });

  it('seeds the starter pet (inactive in the shop) when missing', async () => {
    const { svc, tx } = starterSetup({ item: null });
    await svc.claim('u1');
    expect(tx.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'starter-pet-kitten',
        slot: 'PET',
        isActive: false,
        costCoins: 0,
        categorySlug: 'starter',
      }),
    });
    expect(tx.contentTranslation.createMany).toHaveBeenCalled();
  });

  it('treats a concurrent claim as already claimed', async () => {
    const { svc, tx } = starterSetup({});
    tx.userItem.create.mockRejectedValueOnce(uniqueError());
    const res = await svc.claim('u1');
    expect(res.alreadyClaimed).toBe(true);
  });

  it('cleans pet names', () => {
    expect(cleanPetName('   ')).toBeNull();
    expect(cleanPetName(null)).toBeNull();
    expect(cleanPetName('x'.repeat(40))).toHaveLength(30);
  });
});

describe('Day2PetPushService (docs/10 §2 Day-2 push)', () => {
  // 2026-03-03 23:10 UTC = 20:10 in São Paulo (UTC-3).
  const now = new Date('2026-03-03T23:10:00Z');
  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    timezone: 'America/Sao_Paulo',
    onboardedAt: new Date('2026-03-02T15:00:00Z'),
    reminderMinute: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    petName: 'Legacy',
    items: [{ nickname: 'Byte' }],
    ...over,
  });

  function setup(users: unknown[], lessonsToday = 0) {
    const prisma = {
      user: { findMany: jest.fn(async () => users) },
      progress: { count: jest.fn(async () => lessonsToday) },
      idempotencyRecord: { create: jest.fn(async () => ({})) },
    };
    const notifications = {
      notify: jest.fn(async () => ({ push: { status: 'sent' } })),
    };
    const svc = new Day2PetPushService(prisma as never, notifications as never);
    return { svc, prisma, notifications };
  }

  it('pushes "[pet] is waiting" at the reminder time on day 2, once', async () => {
    const { svc, notifications, prisma } = setup([user()]);
    await expect(svc.run(now)).resolves.toEqual({
      candidates: 1,
      sent: 1,
      skipped: 0,
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      expect.any(Function),
      { now, respectQuietHours: true },
    );
    const build = (notifications.notify.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { title: string; kind: string };
    expect(build({ locale: 'en-US' }).title).toBe('🐾 Byte is waiting!');
    expect(build({ locale: 'en-US' }).kind).toBe('STREAK_REMINDER');
    prisma.idempotencyRecord.create.mockRejectedValueOnce(uniqueError());
    await expect(svc.run(now)).resolves.toEqual(
      expect.objectContaining({ candidates: 0 }),
    );
  });

  it('skips other days, other hours and learners already back', async () => {
    expect(
      (
        await setup([
          user({ onboardedAt: new Date('2026-03-03T12:00:00Z') }),
        ]).svc.run(now)
      ).candidates,
    ).toBe(0);
    expect(
      (await setup([user({ reminderMinute: 9 * 60 })]).svc.run(now)).candidates,
    ).toBe(0);
    expect((await setup([user()], 1).svc.run(now)).skipped).toBe(1);
    expect(
      (
        await setup([
          user({ quietHoursStart: 19 * 60, quietHoursEnd: 7 * 60 }),
        ]).svc.run(now)
      ).skipped,
    ).toBe(1);
  });

  it('falls back to User.petName without a starter-pet nickname', async () => {
    const { svc, notifications } = setup([user({ items: [] })]);
    await svc.run(now);
    const build = (notifications.notify.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { title: string };
    expect(build({ locale: 'en-US' }).title).toBe('🐾 Legacy is waiting!');
  });

  it('copy and dates', () => {
    expect(nextDate('2026-02-28')).toBe('2026-03-01');
    expect(day2Copy('pt-BR', null).title).toBe('🐾 Seu pet está te esperando!');
  });
});
