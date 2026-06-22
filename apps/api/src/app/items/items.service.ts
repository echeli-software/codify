import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Item, ItemSlot, Prisma } from '@prisma/client';
import { evaluatePurchase, isItemAvailable, subscriptionGrantsAccess } from '@codify/domain';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import type {
  AvatarResponse,
  CreateItemCategoryDto,
  CreateItemDto,
  EquippedRef,
  InventoryItem,
  ItemResponse,
  PurchaseResponse,
  ShopItem,
  ShopQueryDto,
  UpdateItemDto,
} from './items.dto.js';

const RARITY_ORDER: Record<string, number> = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 };

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // ─── Categories (admin) ─────────────────────────────────────────────────

  listCategories() {
    return this.prisma.itemCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  async createCategory(input: CreateItemCategoryDto) {
    const dupe = await this.prisma.itemCategory.findUnique({ where: { slug: input.slug } });
    if (dupe) throw new ConflictException('Category slug already in use');
    return this.prisma.itemCategory.create({
      data: { slug: input.slug, name: input.name, sortOrder: input.sortOrder ?? 0 },
    });
  }

  // ─── Items (admin) ──────────────────────────────────────────────────────

  async listItems(): Promise<ItemResponse[]> {
    const rows = await this.prisma.item.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map(toItemResponse);
  }

  async createItem(input: CreateItemDto): Promise<ItemResponse> {
    const dupe = await this.prisma.item.findUnique({ where: { slug: input.slug } });
    if (dupe) throw new ConflictException('Item slug already in use');
    const cat = await this.prisma.itemCategory.findUnique({ where: { slug: input.categorySlug } });
    if (!cat) throw new BadRequestException('Unknown category');
    const created = await this.prisma.item.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        slot: input.slot,
        categorySlug: input.categorySlug,
        rarity: input.rarity ?? 'COMMON',
        costCoins: input.costCoins ?? 0,
        requiredLevel: input.requiredLevel ?? 1,
        isPremiumOnly: input.isPremiumOnly ?? false,
        isLimitedDrop: input.isLimitedDrop ?? false,
        dropStartsAt: input.dropStartsAt ? new Date(input.dropStartsAt) : null,
        dropEndsAt: input.dropEndsAt ? new Date(input.dropEndsAt) : null,
        spriteAssetId: input.spriteAssetId,
        thumbnailAssetId: input.thumbnailAssetId ?? null,
        isActive: input.isActive ?? true,
      },
    });
    return toItemResponse(created);
  }

  async updateItem(id: string, patch: UpdateItemDto): Promise<ItemResponse> {
    const target = await this.prisma.item.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Item not found');
    const updated = await this.prisma.item.update({
      where: { id },
      data: {
        name: patch.name,
        description: patch.description,
        slot: patch.slot,
        categorySlug: patch.categorySlug,
        rarity: patch.rarity,
        costCoins: patch.costCoins,
        requiredLevel: patch.requiredLevel,
        isPremiumOnly: patch.isPremiumOnly,
        isLimitedDrop: patch.isLimitedDrop,
        dropStartsAt: patch.dropStartsAt === undefined ? undefined : patch.dropStartsAt ? new Date(patch.dropStartsAt) : null,
        dropEndsAt: patch.dropEndsAt === undefined ? undefined : patch.dropEndsAt ? new Date(patch.dropEndsAt) : null,
        spriteAssetId: patch.spriteAssetId,
        thumbnailAssetId: patch.thumbnailAssetId,
        isActive: patch.isActive,
      },
    });
    return toItemResponse(updated);
  }

  async deleteItem(id: string): Promise<void> {
    const target = await this.prisma.item.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Item not found');
    await this.prisma.item.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  // ─── Shop (student) ─────────────────────────────────────────────────────

  async shop(userId: string, query: ShopQueryDto): Promise<ShopItem[]> {
    const where: Prisma.ItemWhereInput = { deletedAt: null, isActive: true };
    if (query.slot) where.slot = query.slot;
    if (query.categorySlug) where.categorySlug = query.categorySlug;
    if (query.rarity) where.rarity = query.rarity;
    if (query.premiumOnly === 'true') where.isPremiumOnly = true;

    const [items, ctx, owned] = await Promise.all([
      this.prisma.item.findMany({ where }),
      this.userContext(userId),
      this.ownedItemIds(userId),
    ]);
    const now = new Date();

    let shop = items
      .filter((i) => isItemAvailable(i, now) || !i.isLimitedDrop)
      .map((i) => {
        const eligibility = evaluatePurchase({
          item: i,
          userCoins: ctx.coins,
          userLevel: ctx.level,
          isPremium: ctx.isPremium,
          owned: owned.has(i.id),
          now,
        });
        return { ...toItemResponse(i), owned: owned.has(i.id), canBuy: eligibility.canBuy, reason: eligibility.reason };
      });

    if (query.affordableOnly === 'true') shop = shop.filter((s) => s.canBuy);

    // Limited drops first, then by rarity desc, then cheapest.
    shop.sort((a, b) => {
      if (a.isLimitedDrop !== b.isLimitedDrop) return a.isLimitedDrop ? -1 : 1;
      const r = (RARITY_ORDER[b.rarity] ?? 0) - (RARITY_ORDER[a.rarity] ?? 0);
      if (r !== 0) return r;
      return a.costCoins - b.costCoins;
    });
    return shop;
  }

  /**
   * Buy an item. Server re-checks eligibility, debits coins through the
   * gamification ledger (ITEM_PURCHASE), and records the UserItem — all in
   * one transaction. Idempotent: the UserItem (userId,itemId) unique +
   * the spend idempotency key prevent a double charge.
   */
  async purchase(userId: string, itemId: string): Promise<PurchaseResponse> {
    const item = await this.prisma.item.findFirst({ where: { id: itemId, deletedAt: null, isActive: true } });
    if (!item) throw new NotFoundException('Item not found');

    const ctx = await this.userContext(userId);
    const alreadyOwned = await this.prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      select: { id: true },
    });
    const eligibility = evaluatePurchase({
      item,
      userCoins: ctx.coins,
      userLevel: ctx.level,
      isPremium: ctx.isPremium,
      owned: !!alreadyOwned,
    });
    if (!eligibility.canBuy) throw purchaseError(eligibility.reason);

    const coins = await this.prisma.$transaction(async (tx) => {
      const spend = await this.gamification.spendCoins(
        { userId, amount: item.costCoins, source: 'ITEM_PURCHASE', refType: 'item', refId: item.id, idempotencyKey: `purchase:${userId}:${item.id}` },
        tx,
      );
      await tx.userItem.create({ data: { userId, itemId: item.id, source: 'PURCHASE' } });
      return spend.coins;
    });
    return { item: toItemResponse(item), coins };
  }

  // ─── Inventory + avatar (student) ───────────────────────────────────────

  async inventory(userId: string): Promise<InventoryItem[]> {
    const [rows, equipped] = await Promise.all([
      this.prisma.userItem.findMany({ where: { userId }, include: { item: true }, orderBy: { acquiredAt: 'desc' } }),
      this.prisma.equippedItem.findMany({ where: { userId }, select: { itemId: true } }),
    ]);
    const equippedIds = new Set(equipped.map((e) => e.itemId));
    return rows
      .filter((r) => r.item.deletedAt === null)
      .map((r) => ({
        item: toItemResponse(r.item),
        equipped: equippedIds.has(r.itemId),
        acquiredAt: r.acquiredAt.toISOString(),
        source: r.source,
      }));
  }

  async getAvatar(userId: string): Promise<AvatarResponse> {
    const [user, equipped] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarConfig: true } }),
      this.prisma.equippedItem.findMany({ where: { userId }, include: { item: true } }),
    ]);
    const map: AvatarResponse['equipped'] = {};
    for (const e of equipped) {
      if (e.item.deletedAt) continue;
      map[e.slot] = {
        itemId: e.itemId,
        slug: e.item.slug,
        name: e.item.name,
        slot: e.slot,
        rarity: e.item.rarity,
        spriteAssetId: e.item.spriteAssetId,
      } satisfies EquippedRef;
    }
    return { config: (user.avatarConfig as Record<string, unknown> | null) ?? null, equipped: map };
  }

  async saveConfig(userId: string, config: Record<string, unknown>): Promise<AvatarResponse> {
    await this.prisma.user.update({ where: { id: userId }, data: { avatarConfig: config as Prisma.InputJsonValue } });
    return this.getAvatar(userId);
  }

  /** Equip an owned item into its slot, or unequip when itemId is null. */
  async equip(userId: string, slot: ItemSlot, itemId: string | null | undefined): Promise<AvatarResponse> {
    if (!itemId) {
      await this.prisma.equippedItem.deleteMany({ where: { userId, slot } });
      return this.getAvatar(userId);
    }
    const owned = await this.prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      include: { item: true },
    });
    if (!owned) throw new ForbiddenException('You do not own this item');
    if (owned.item.slot !== slot) throw new BadRequestException(`Item belongs to slot ${owned.item.slot}, not ${slot}`);
    await this.prisma.equippedItem.upsert({
      where: { userId_slot: { userId, slot } },
      create: { userId, slot, itemId },
      update: { itemId },
    });
    return this.getAvatar(userId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async userContext(userId: string): Promise<{ coins: number; level: number; isPremium: boolean }> {
    const [user, subs] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coins: true, totalXp: true } }),
      this.prisma.subscription.findMany({ where: { userId }, select: { status: true, currentPeriodEnd: true, planId: true } }),
    ]);
    const now = new Date();
    const isPremium = subs.some((s) =>
      subscriptionGrantsAccess({ planId: s.planId, status: s.status, currentPeriodEnd: s.currentPeriodEnd }, now),
    );
    return { coins: user.coins, level: levelFromXp(user.totalXp), isPremium };
  }

  private async ownedItemIds(userId: string): Promise<Set<string>> {
    const owned = await this.prisma.userItem.findMany({ where: { userId }, select: { itemId: true } });
    return new Set(owned.map((o) => o.itemId));
  }
}

function purchaseError(reason: string) {
  switch (reason) {
    case 'owned':
      return new ConflictException('You already own this item');
    case 'premium_required':
      return new ForbiddenException('This item is premium-only');
    case 'level_locked':
      return new ForbiddenException('Your level is too low for this item');
    case 'not_available':
      return new BadRequestException('This item is not currently available');
    case 'insufficient_coins':
      return new BadRequestException('Not enough coins');
    default:
      return new BadRequestException('Cannot purchase this item');
  }
}

function toItemResponse(i: Item): ItemResponse {
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    description: i.description,
    slot: i.slot,
    categorySlug: i.categorySlug,
    rarity: i.rarity,
    costCoins: i.costCoins,
    requiredLevel: i.requiredLevel,
    isPremiumOnly: i.isPremiumOnly,
    isLimitedDrop: i.isLimitedDrop,
    dropStartsAt: i.dropStartsAt?.toISOString() ?? null,
    dropEndsAt: i.dropEndsAt?.toISOString() ?? null,
    spriteAssetId: i.spriteAssetId,
    thumbnailAssetId: i.thumbnailAssetId,
    isActive: i.isActive,
  };
}
