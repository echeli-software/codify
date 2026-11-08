import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Per-pet names (docs/08 §10): every owned PET item can be named
 * (`UserItem.nickname`). `petName` in older response shapes is kept as an
 * alias for the **equipped** pet's name.
 */

/** The equipped pet's ownership row (only what naming needs). */
export interface EquippedPetRow {
  itemId: string;
  nickname: string | null;
  /** `ItemAcquisitionSource`; ONBOARDING = the starter pet. */
  source: string;
}

/**
 * The backwards-compatible `petName`: the equipped pet's nickname. The
 * legacy `User.petName` is the fallback when no pet is equipped, or when
 * the equipped (starter) pet has no nickname of its own — never for some
 * other pet, which would then wear the starter pet's name.
 */
export function petNameAlias(
  pet: Pick<EquippedPetRow, 'nickname' | 'source'> | null | undefined,
  legacy: string | null | undefined,
): string | null {
  if (!pet) return legacy ?? null;
  if (pet.nickname) return pet.nickname;
  return pet.source === 'ONBOARDING' ? (legacy ?? null) : null;
}

/** The user's equipped pet (not soft-deleted) with its nickname, or null. */
export async function loadEquippedPet(
  prisma: Pick<PrismaService, 'userItem'>,
  userId: string,
): Promise<EquippedPetRow | null> {
  const row = await prisma.userItem.findFirst({
    where: {
      userId,
      item: {
        slot: 'PET',
        deletedAt: null,
        equippedItems: { some: { userId, slot: 'PET' } },
      },
    },
    select: { itemId: true, nickname: true, source: true },
  });
  return row ?? null;
}
