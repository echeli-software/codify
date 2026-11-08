import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service.js';
import { PetNamesService } from './pet-names.service.js';
import { loadEquippedPet, petNameAlias } from './pet-names.js';

describe('petNameAlias (docs/08 §10)', () => {
  it("is the equipped pet's nickname", () => {
    expect(petNameAlias({ nickname: 'Rex', source: 'PURCHASE' }, 'Byte')).toBe(
      'Rex',
    );
  });

  it('falls back to User.petName for the starter pet or no pet', () => {
    expect(petNameAlias({ nickname: null, source: 'ONBOARDING' }, 'Byte')).toBe(
      'Byte',
    );
    expect(petNameAlias(null, 'Byte')).toBe('Byte');
    expect(petNameAlias(undefined, undefined)).toBeNull();
    expect(petNameAlias({ nickname: null, source: 'ONBOARDING' }, null)).toBe(
      null,
    );
  });

  it("never gives another pet the starter pet's name", () => {
    expect(
      petNameAlias({ nickname: null, source: 'PURCHASE' }, 'Byte'),
    ).toBeNull();
  });
});

describe('loadEquippedPet', () => {
  it('reads the owned row of the pet in the PET slot', async () => {
    const findFirst = jest.fn(async () => null);
    await expect(
      loadEquippedPet({ userItem: { findFirst } } as never, 'u1'),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        item: {
          slot: 'PET',
          deletedAt: null,
          equippedItems: { some: { userId: 'u1', slot: 'PET' } },
        },
      },
      select: { itemId: true, nickname: true, source: true },
    });
  });
});

function renameSetup(owned: unknown) {
  const prisma = {
    userItem: {
      findUnique: jest.fn(async () => owned),
      update: jest.fn((args: unknown) => ({ userItem: args })),
    },
    user: { update: jest.fn((args: unknown) => ({ user: args })) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const items = {
    getAvatar: jest.fn(async () => ({ config: {}, equipped: {} })),
  };
  const svc = new PetNamesService(prisma as never, items as never);
  return { svc, prisma, items };
}

const pet = (over: Record<string, unknown> = {}) => ({
  source: 'PURCHASE',
  item: { slot: 'PET', deletedAt: null },
  ...over,
});

describe('PetNamesService.rename', () => {
  it('stores a cleaned nickname on the owned pet', async () => {
    const { svc, prisma, items } = renameSetup(pet());
    const res = await svc.rename('u1', 'dog', '  Rex   the  dog ');
    expect(prisma.userItem.update).toHaveBeenCalledWith({
      where: { userId_itemId: { userId: 'u1', itemId: 'dog' } },
      data: { nickname: 'Rex the dog' },
    });
    // Not the starter pet: the legacy User.petName is left alone.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(res).toEqual({
      itemId: 'dog',
      nickname: 'Rex the dog',
      avatar: await items.getAvatar.mock.results[0].value,
    });
  });

  it('mirrors the starter pet name to User.petName and clears on blank', async () => {
    const { svc, prisma } = renameSetup(pet({ source: 'ONBOARDING' }));
    const res = await svc.rename('u1', 'kitten', '   ');
    expect(res.nickname).toBeNull();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { petName: null },
    });
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('404s for an item the user does not own (or that was deleted)', async () => {
    await expect(
      renameSetup(null).svc.rename('u1', 'x', 'Rex'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const deleted = renameSetup(
      pet({ item: { slot: 'PET', deletedAt: new Date() } }),
    );
    const err = await deleted.svc
      .rename('u1', 'x', 'Rex')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toEqual(
      expect.objectContaining({ code: 'pet.not_owned' }),
    );
    expect(deleted.prisma.userItem.update).not.toHaveBeenCalled();
  });

  it('400s for an owned item that is not a pet', async () => {
    const { svc, prisma } = renameSetup(
      pet({ item: { slot: 'HAT', deletedAt: null } }),
    );
    const err = await svc.rename('u1', 'hat', 'Rex').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ code: 'pet.not_a_pet' }),
    );
    expect(prisma.userItem.update).not.toHaveBeenCalled();
  });
});

describe('ItemsService pet names in responses', () => {
  function setup(petRow: unknown) {
    const kitten = {
      id: 'kitten',
      slug: 'kitten',
      name: 'Kitten',
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
      isActive: true,
      deletedAt: null,
      category: { name: 'Starter' },
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn(async () => ({
          avatarConfig: {},
          petName: 'Legacy',
        })),
      },
      equippedItem: {
        findMany: jest.fn(async (args: { select?: unknown }) =>
          args.select
            ? [{ itemId: 'kitten' }]
            : [{ slot: 'PET', itemId: 'kitten', item: kitten }],
        ),
      },
      userItem: {
        findFirst: jest.fn(async () => petRow),
        findMany: jest.fn(async () => [
          {
            itemId: 'kitten',
            item: kitten,
            acquiredAt: new Date('2026-01-01T00:00:00Z'),
            source: 'ONBOARDING',
            nickname: 'Mimi',
          },
        ]),
      },
      asset: { findMany: jest.fn(async () => []) },
    };
    const svc = new ItemsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return svc;
  }

  it('returns the equipped pet nickname and the petName alias', async () => {
    const av = await setup({
      itemId: 'kitten',
      nickname: 'Mimi',
      source: 'ONBOARDING',
    }).getAvatar('u1');
    expect(av.petName).toBe('Mimi');
    expect(av.equipped.PET?.nickname).toBe('Mimi');
  });

  it('lists each owned item with its nickname', async () => {
    const inv = await setup(null).inventory('u1');
    expect(inv).toEqual([
      expect.objectContaining({ nickname: 'Mimi', equipped: true }),
    ]);
  });
});
