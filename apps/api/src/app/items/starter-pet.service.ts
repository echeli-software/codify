import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Item, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import type {
  ClaimStarterPetResponse,
  ItemResponse,
  StarterPetStatus,
} from './items.dto.js';
import { ItemsService, toItemResponse } from './items.service.js';
import { loadSpriteUrls } from './sprite-urls.js';

/** The onboarding gift (docs/10 §2 "First reward", docs/08 §10 Pets). */
export const STARTER_PET_SLUG = 'starter-pet-kitten';
export const STARTER_CATEGORY_SLUG = 'starter';

/** Seeded when the catalog has no starter pet yet (source text is pt-BR). */
const STARTER_PET_SEED = {
  slug: STARTER_PET_SLUG,
  name: 'Gatinho',
  description: 'Seu primeiro companheiro de estudos — presente de boas-vindas.',
  slot: 'PET',
  rarity: 'COMMON',
  costCoins: 0,
  requiredLevel: 1,
  spriteAssetId: 'emoji:🐱',
  // Not sold in the shop: it's only ever given (ItemAcquisitionSource.ONBOARDING).
  isActive: false,
} as const;
const STARTER_PET_EN = {
  name: 'Kitten',
  description: 'Your first study buddy — a welcome gift.',
};

/** Trimmed pet name, or null for blank. */
export function cleanPetName(name: string | null | undefined): string | null {
  const v = (name ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 30) : null;
}

/**
 * The free starter pet: given once per user (a `UserItem` with source
 * ONBOARDING), after the first completed lesson, equipped in the PET slot
 * when that slot is empty, and optionally named (`UserItem.nickname`,
 * mirrored to the legacy `User.petName`). The item
 * is seeded on first use when the catalog doesn't have one, so a fresh
 * environment works without admin setup.
 */
@Injectable()
export class StarterPetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  async status(userId: string): Promise<StarterPetStatus> {
    const [claimed, lessons, user] = await Promise.all([
      this.prisma.userItem.findFirst({
        where: { userId, source: 'ONBOARDING', item: { slot: 'PET' } },
        include: { item: true },
      }),
      this.prisma.progress.count({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { petName: true },
      }),
    ]);
    const item = claimed?.item ?? (await this.ensureItem());
    return {
      claimed: !!claimed,
      eligible: !claimed && lessons > 0,
      item: item ? await this.respond(item) : null,
      // The gift's own name (docs/08 §10), else the legacy User.petName.
      petName: claimed?.nickname ?? user.petName ?? null,
    };
  }

  /**
   * Open the gift. Idempotent: a second call reports `alreadyClaimed`
   * (and still applies a new `petName`). 409 `starter_pet.locked` before the
   * first lesson is completed; 404 `starter_pet.unavailable` when an admin
   * removed the starter pet.
   */
  async claim(
    userId: string,
    opts: { petName?: string | null } = {},
  ): Promise<ClaimStarterPetResponse> {
    const before = await this.status(userId);
    if (!before.claimed && !before.eligible)
      throw new ConflictException({
        code: 'starter_pet.locked',
        message: 'Complete your first lesson to unlock your starter pet',
      });
    const item = await this.ensureItem();
    if (!item && !before.claimed)
      throw new NotFoundException({
        code: 'starter_pet.unavailable',
        message: 'The starter pet is not available',
      });
    const petName = cleanPetName(opts.petName);

    let alreadyClaimed = before.claimed;
    if (!before.claimed && item) {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.userItem.create({
            data: { userId, itemId: item.id, source: 'ONBOARDING' },
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          alreadyClaimed = true; // a concurrent claim won
          return;
        }
        // Wear it right away, unless another pet is already out.
        const pet = await tx.equippedItem.findUnique({
          where: { userId_slot: { userId, slot: 'PET' } },
          select: { itemId: true },
        });
        if (!pet)
          await tx.equippedItem.create({
            data: { userId, slot: 'PET', itemId: item.id },
          });
      });
    }
    if (petName)
      await this.prisma.$transaction([
        this.prisma.userItem.updateMany({
          where: { userId, source: 'ONBOARDING', item: { slot: 'PET' } },
          data: { nickname: petName },
        }),
        // Legacy mirror for clients that still read User.petName.
        this.prisma.user.update({
          where: { id: userId },
          data: { petName },
        }),
      ]);
    const after = await this.status(userId);
    return {
      ...after,
      alreadyClaimed,
      avatar: await this.items.getAvatar(userId),
    };
  }

  /** The starter pet item, seeding it (and its category) when missing. */
  private async ensureItem(): Promise<Item | null> {
    const existing = await this.prisma.item.findUnique({
      where: { slug: STARTER_PET_SLUG },
    });
    if (existing) return existing.deletedAt ? null : existing;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.itemCategory.upsert({
          where: { slug: STARTER_CATEGORY_SLUG },
          create: { slug: STARTER_CATEGORY_SLUG, name: 'Iniciante' },
          update: {},
        });
        const created = await tx.item.create({
          data: {
            ...STARTER_PET_SEED,
            categorySlug: STARTER_CATEGORY_SLUG,
          } satisfies Prisma.ItemUncheckedCreateInput,
        });
        await tx.contentTranslation.createMany({
          data: (['name', 'description'] as const).map((field) => ({
            entityType: 'ITEM' as const,
            entityId: created.id,
            locale: 'en-US',
            field,
            value: STARTER_PET_EN[field],
          })),
          skipDuplicates: true,
        });
        return created;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Seeded concurrently by another request.
      return this.prisma.item.findUnique({ where: { slug: STARTER_PET_SLUG } });
    }
  }

  private async respond(item: Item): Promise<ItemResponse> {
    const out = toItemResponse(
      item,
      await loadSpriteUrls(this.prisma, [item.spriteAssetId]),
    );
    if (this.localizer) {
      const tr = await this.localizer.localize([
        {
          entityType: 'ITEM',
          items: [
            {
              id: item.id,
              values: { name: item.name, description: item.description },
            },
          ],
        },
      ]);
      tr.apply('ITEM', item.id, out, ['name', 'description']);
    }
    return out;
  }
}
