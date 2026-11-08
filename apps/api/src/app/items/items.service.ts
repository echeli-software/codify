import { Cron } from '@nestjs/schedule';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Item, ItemSlot, Prisma } from '@prisma/client';
import {
  evaluatePurchase,
  isItemAvailable,
  validateDropWindow,
} from '@codify/domain';
import {
  levelFromXp,
  normalizeAvatarConfig,
  randomAvatarConfig,
  validateAvatarConfig,
} from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { avatarWriteTime, isStaleWrite } from './avatar-lww.js';
import { AccessService } from '../billing/access.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { UserPushService } from '../gamification/user-push.service.js';
import { jobsEnabled, ENGAGEMENT_CRONS } from '../gamification/jobs.js';
import {
  ContentLocalizer,
  changedFields,
} from '../translations/content-localizer.service.js';
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
import { ItemDropsService, renderDropCopy } from './item-drops.service.js';
import {
  isAssetSpriteRef,
  loadSpriteUrls,
  spriteUrlFor,
  type SpriteUrlMap,
} from './sprite-urls.js';

const RARITY_ORDER: Record<string, number> = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};
/** Slots "Random" shuffles by default (EMOTE is a one-shot, docs/08 §2). */
const RANDOM_SLOTS: ItemSlot[] = [
  'PET',
  'BACKGROUND',
  'TOP',
  'BOTTOM',
  'SHOES',
  'HAT',
  'HAIR',
  'GLASSES',
  'ACCESSORY',
  'FRAME',
];
/** Never announce a drop that went live longer ago than this. */
const DROP_ANNOUNCE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Drop pushes go to students seen in the last 30 days. */
const DROP_AUDIENCE_ACTIVE_MS = 30 * 24 * 60 * 60 * 1000;
/** Category name for student-facing item lists (translated as ITEM_CATEGORY). */
const WITH_CATEGORY_NAME = {
  category: { select: { name: true } },
} satisfies Prisma.ItemInclude;

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly push: UserPushService,
    private readonly access: AccessService,
    @Optional() private readonly localizer?: ContentLocalizer,
    @Optional() private readonly drops?: ItemDropsService,
  ) {}

  // ─── Categories (admin) ─────────────────────────────────────────────────

  listCategories() {
    return this.prisma.itemCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  async createCategory(input: CreateItemCategoryDto) {
    const dupe = await this.prisma.itemCategory.findUnique({
      where: { slug: input.slug },
    });
    if (dupe) throw new ConflictException('Category slug already in use');
    return this.prisma.itemCategory.create({
      data: {
        slug: input.slug,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  // ─── Items (admin) ──────────────────────────────────────────────────────

  async listItems(): Promise<ItemResponse[]> {
    const rows = await this.prisma.item.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const urls = await this.spriteUrls(rows);
    return rows.map((r) => toItemResponse(r, urls));
  }

  async createItem(input: CreateItemDto): Promise<ItemResponse> {
    const dupe = await this.prisma.item.findUnique({
      where: { slug: input.slug },
    });
    if (dupe) throw new ConflictException('Item slug already in use');
    const cat = await this.prisma.itemCategory.findUnique({
      where: { slug: input.categorySlug },
    });
    if (!cat) throw new BadRequestException('Unknown category');
    await this.assertSpriteAssets(input.spriteAssetId, input.thumbnailAssetId);
    assertDropWindow({
      isLimitedDrop: input.isLimitedDrop ?? false,
      dropStartsAt: input.dropStartsAt || null,
      dropEndsAt: input.dropEndsAt || null,
    });
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
    return toItemResponse(created, await this.spriteUrls([created]));
  }

  /**
   * Patch an item. Returns the row as it was before the patch and as it is
   * after, so the controller can audit both (docs/14 §12).
   */
  async updateItem(
    id: string,
    patch: UpdateItemDto,
  ): Promise<{ before: ItemResponse; after: ItemResponse }> {
    const target = await this.prisma.item.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Item not found');
    await this.assertSpriteAssets(patch.spriteAssetId, patch.thumbnailAssetId);
    if (
      patch.categorySlug !== undefined &&
      patch.categorySlug !== target.categorySlug
    ) {
      const cat = await this.prisma.itemCategory.findUnique({
        where: { slug: patch.categorySlug },
      });
      if (!cat) throw new BadRequestException('Unknown category');
    }
    // Validate the drop window as it will be stored after the patch (only
    // when the patch touches it, so legacy rows stay editable).
    if (
      patch.isLimitedDrop !== undefined ||
      patch.dropStartsAt !== undefined ||
      patch.dropEndsAt !== undefined
    ) {
      assertDropWindow({
        isLimitedDrop: patch.isLimitedDrop ?? target.isLimitedDrop,
        dropStartsAt:
          patch.dropStartsAt === undefined
            ? target.dropStartsAt
            : patch.dropStartsAt || null,
        dropEndsAt:
          patch.dropEndsAt === undefined
            ? target.dropEndsAt
            : patch.dropEndsAt || null,
      });
    }
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
        dropStartsAt:
          patch.dropStartsAt === undefined
            ? undefined
            : patch.dropStartsAt
              ? new Date(patch.dropStartsAt)
              : null,
        dropEndsAt:
          patch.dropEndsAt === undefined
            ? undefined
            : patch.dropEndsAt
              ? new Date(patch.dropEndsAt)
              : null,
        spriteAssetId: patch.spriteAssetId,
        thumbnailAssetId: patch.thumbnailAssetId,
        isActive: patch.isActive,
      },
    });
    // Source text changed → its translations need review (docs/11 §3).
    await this.localizer?.markSourceChanged(
      'ITEM',
      id,
      changedFields(target, patch, ['name', 'description']),
    );
    const urls = await this.spriteUrls([target, updated]);
    return {
      before: toItemResponse(target, urls),
      after: toItemResponse(updated, urls),
    };
  }

  /** Soft-delete an item; returns the row as it was (for the audit). */
  async deleteItem(id: string): Promise<ItemResponse> {
    const target = await this.prisma.item.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Item not found');
    await this.prisma.item.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return toItemResponse(target, await this.spriteUrls([target]));
  }

  // ─── Shop (student) ─────────────────────────────────────────────────────

  async shop(userId: string, query: ShopQueryDto): Promise<ShopItem[]> {
    const where: Prisma.ItemWhereInput = { deletedAt: null, isActive: true };
    if (query.slot) where.slot = query.slot;
    if (query.categorySlug) where.categorySlug = query.categorySlug;
    if (query.rarity) where.rarity = query.rarity;
    if (query.premiumOnly === 'true') where.isPremiumOnly = true;

    const [items, ctx, owned] = await Promise.all([
      this.prisma.item.findMany({ where, include: WITH_CATEGORY_NAME }),
      this.userContext(userId),
      this.ownedItemIds(userId),
    ]);
    const now = new Date();
    const urls = await this.spriteUrls(items);

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
        return {
          ...toItemResponse(i, urls),
          categoryName: i.category?.name,
          owned: owned.has(i.id),
          canBuy: eligibility.canBuy,
          reason: eligibility.reason,
        };
      });

    if (query.affordableOnly === 'true') shop = shop.filter((s) => s.canBuy);
    await this.localizeItems(shop);

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
  async purchase(
    userId: string,
    itemId: string,
    opts: { equip?: boolean } = {},
  ): Promise<PurchaseResponse> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, deletedAt: null, isActive: true },
    });
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
      // spendCoins row-locks the user, so concurrent purchases serialize here.
      const spend = await this.gamification.spendCoins(
        {
          userId,
          amount: item.costCoins,
          source: 'ITEM_PURCHASE',
          refType: 'item',
          refId: item.id,
          idempotencyKey: `purchase:${userId}:${item.id}`,
        },
        tx,
      );
      try {
        await tx.userItem.create({
          data: { userId, itemId: item.id, source: 'PURCHASE' },
        });
      } catch (err) {
        // A concurrent purchase of the same item won the race: roll back.
        if (isUniqueViolation(err))
          throw new ConflictException('You already own this item');
        throw err;
      }
      if (opts.equip) {
        // Equip in the same transaction — buying and wearing is atomic.
        await tx.equippedItem.upsert({
          where: { userId_slot: { userId, slot: item.slot } },
          create: { userId, slot: item.slot, itemId: item.id },
          update: { itemId: item.id },
        });
      }
      return spend.coins;
    });
    const bought = toItemResponse(item, await this.spriteUrls([item]));
    await this.localizeItems([bought]);
    return { item: bought, coins, equipped: !!opts.equip };
  }

  // ─── Limited drops ──────────────────────────────────────────────────────

  /**
   * Announce limited drops that went live since the last run (docs/08
   * §Limited drops, docs/10 ITEM_DROP). Idempotent per item via an
   * `IdempotencyRecord` (`item_drop:<itemId>`), so overlapping runs or
   * replicas announce each drop once. Drops that started more than
   * {@link DROP_ANNOUNCE_LOOKBACK_MS} ago are never announced (no stale
   * pushes when the job is first deployed or was down).
   *
   * is the job entry point.
   */
  async announceDrops(
    now: Date = new Date(),
  ): Promise<{ drops: number; pushed: number }> {
    const drops = await this.prisma.item.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isLimitedDrop: true,
        dropStartsAt: {
          lte: now,
          gt: new Date(now.getTime() - DROP_ANNOUNCE_LOOKBACK_MS),
        },
        OR: [{ dropEndsAt: null }, { dropEndsAt: { gt: now } }],
      },
      orderBy: { dropStartsAt: 'asc' },
    });
    let announced = 0;
    let pushed = 0;
    // Per-recipient-locale item names (docs/11 §3).
    const names =
      (await this.localizer?.byLocale(
        'ITEM',
        drops.map((d) => d.id),
        'name',
      )) ?? new Map<string, string>();
    for (const item of drops) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: { key: `item_drop:${item.id}`, scope: 'item_drop' },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue; // already announced
        throw err;
      }
      announced += 1;
      const audience = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          role: 'STUDENT',
          lastSeenAt: {
            gte: new Date(now.getTime() - DROP_AUDIENCE_ACTIVE_MS),
          },
          deviceTokens: { some: {} },
        },
        select: { id: true },
      });
      // Copy written in the drop wizard wins over the default (docs/04).
      const custom = (await this.drops?.copyFor([item.id]))?.get(item.id);
      for (const u of audience) {
        const res = await this.push.sendToUser(
          u.id,
          ({ locale }) => {
            const name = names.get(`${item.id}|${locale}`) ?? item.name;
            const base = dropCopy(locale, { ...item, name });
            const own = custom?.get(locale);
            return own ? { ...base, ...renderDropCopy(own, name) } : base;
          },
          now,
        );
        pushed += res.sent;
      }
    }
    return { drops: announced, pushed };
  }

  /** Job entry point (no-op under jest or with JOBS_ENABLED=false). */
  @Cron(ENGAGEMENT_CRONS.dropAnnouncements, {
    name: 'runScheduledDropAnnouncements',
    timeZone: 'UTC',
  })
  async runScheduledDropAnnouncements(): Promise<{
    drops: number;
    pushed: number;
  } | null> {
    if (!jobsEnabled()) return null;
    try {
      return await this.announceDrops();
    } catch (err) {
      this.logger.error(`drop announcements failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Inventory + avatar (student) ───────────────────────────────────────

  async inventory(userId: string): Promise<InventoryItem[]> {
    const [rows, equipped] = await Promise.all([
      this.prisma.userItem.findMany({
        where: { userId },
        include: { item: { include: WITH_CATEGORY_NAME } },
        orderBy: { acquiredAt: 'desc' },
      }),
      this.prisma.equippedItem.findMany({
        where: { userId },
        select: { itemId: true },
      }),
    ]);
    const equippedIds = new Set(equipped.map((e) => e.itemId));
    const urls = await this.spriteUrls(rows.map((r) => r.item));
    const out = rows
      .filter((r) => r.item.deletedAt === null)
      .map((r) => ({
        item: {
          ...toItemResponse(r.item, urls),
          categoryName: r.item.category?.name,
        },
        equipped: equippedIds.has(r.itemId),
        acquiredAt: r.acquiredAt.toISOString(),
        source: r.source,
      }));
    await this.localizeItems(out.map((o) => o.item));
    return out;
  }

  async getAvatar(userId: string): Promise<AvatarResponse> {
    const [user, equipped] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarConfig: true, petName: true },
      }),
      this.prisma.equippedItem.findMany({
        where: { userId },
        include: { item: true },
      }),
    ]);
    const urls = await this.spriteUrls(equipped.map((e) => e.item));
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
        spriteUrl: spriteUrlFor(e.item.spriteAssetId, urls),
      } satisfies EquippedRef;
    }
    await this.localizeEquipped(map);
    return {
      // The full AvatarConfig: stored values, defaults for missing ones.
      config: { ...normalizeAvatarConfig(user.avatarConfig) },
      equipped: map,
      petName: user.petName ?? null,
    };
  }

  /**
   * Save the avatar config. Offline edits (docs/16 §8) pass the device
   * `clientTimestamp`: last write wins against `User.avatarUpdatedAt`, so a
   * change synced late never overwrites a newer one (`stale: true`).
   */
  async saveConfig(
    userId: string,
    config: Record<string, unknown>,
    clientTimestamp?: string | null,
  ): Promise<AvatarResponse> {
    // AvatarConfig patch (docs/08 §5): known keys, curated values only.
    const valid = validateAvatarConfig(config);
    if (!valid.ok)
      throw new BadRequestException({
        code: 'avatar.config_invalid',
        message: 'Invalid avatar settings',
        errors: valid.errors,
      });
    const at = avatarWriteTime(clientTimestamp);
    if (clientTimestamp) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { avatarUpdatedAt: true },
      });
      if (isStaleWrite(at, current?.avatarUpdatedAt))
        return { ...(await this.getAvatar(userId)), stale: true };
    }
    const stored = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarConfig: true },
    });
    // The patch is merged over the stored (normalized) config.
    const merged = {
      ...normalizeAvatarConfig(stored.avatarConfig),
      ...valid.value,
    };
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarConfig: merged as unknown as Prisma.InputJsonValue,
        avatarUpdatedAt: at,
      },
    });
    return this.getAvatar(userId);
  }

  /**
   * Equip an owned item into its slot, or unequip when itemId is null.
   * With a `clientTimestamp` (offline queue) the change is last-write-wins
   * per slot (docs/16 §8, `stale: true` when it lost): an equip loses to a
   * newer `EquippedItem.updatedAt` and to a newer unequip, which leaves an
   * `AvatarSlotTombstone` behind. Live writes (no timestamp) always win.
   */
  async equip(
    userId: string,
    slot: ItemSlot,
    itemId: string | null | undefined,
    clientTimestamp?: string | null,
  ): Promise<AvatarResponse> {
    const at = avatarWriteTime(clientTimestamp);
    if (!itemId) return this.unequip(userId, slot, at, !!clientTimestamp);
    if (clientTimestamp) {
      const where = { userId_slot: { userId, slot } };
      const [row, tombstone] = await Promise.all([
        this.prisma.equippedItem.findUnique({
          where,
          select: { updatedAt: true },
        }),
        this.prisma.avatarSlotTombstone.findUnique({
          where,
          select: { clearedAt: true },
        }),
      ]);
      if (
        isStaleWrite(at, row?.updatedAt) ||
        isStaleWrite(at, tombstone?.clearedAt)
      )
        return { ...(await this.getAvatar(userId)), stale: true };
    }
    const owned = await this.prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      include: { item: true },
    });
    if (!owned) throw new ForbiddenException('You do not own this item');
    if (owned.item.slot !== slot)
      throw new BadRequestException(
        `Item belongs to slot ${owned.item.slot}, not ${slot}`,
      );
    await this.prisma.$transaction([
      this.prisma.equippedItem.upsert({
        where: { userId_slot: { userId, slot } },
        create: {
          userId,
          slot,
          itemId,
          ...(clientTimestamp ? { updatedAt: at } : {}),
        },
        update: { itemId, ...(clientTimestamp ? { updatedAt: at } : {}) },
      }),
      // The equip supersedes an older unequip of the slot.
      this.prisma.avatarSlotTombstone.deleteMany({
        where: { userId, slot, clearedAt: { lte: at } },
      }),
    ]);
    return this.getAvatar(userId);
  }

  /**
   * Empty a slot at `at`. The tombstone keeps the latest unequip time
   * (max of the stored one and `at`) so an older queued equip replayed
   * later loses. With `lww` (offline queue) the equipped row is removed
   * only when it is not newer than `at`; otherwise the unequip is `stale`.
   */
  private async unequip(
    userId: string,
    slot: ItemSlot,
    at: Date,
    lww: boolean,
  ): Promise<AvatarResponse> {
    const where = { userId_slot: { userId, slot } };
    const stale = await this.prisma.$transaction(async (tx) => {
      const tombstone = await tx.avatarSlotTombstone.findUnique({
        where,
        select: { clearedAt: true },
      });
      if (!tombstone || tombstone.clearedAt.getTime() < at.getTime())
        await tx.avatarSlotTombstone.upsert({
          where,
          create: { userId, slot, clearedAt: at },
          update: { clearedAt: at },
        });
      const removed = await tx.equippedItem.deleteMany({
        where: { userId, slot, ...(lww ? { updatedAt: { lte: at } } : {}) },
      });
      if (!lww || removed.count > 0) return false;
      // Nothing removed: the slot was already empty, or a newer equip holds it.
      return !!(await tx.equippedItem.findUnique({
        where,
        select: { updatedAt: true },
      }));
    });
    const avatar = await this.getAvatar(userId);
    return stale ? { ...avatar, stale: true } : avatar;
  }

  /**
   * "Random" (docs/08 §9): equip a random owned item in every slot that has
   * owned items (EMOTE is transient and skipped unless asked for); with
   * `look` also a random base look — the skin tone is personal and kept.
   */
  async randomize(
    userId: string,
    opts: { slots?: ItemSlot[]; look?: boolean } = {},
    rng: () => number = Math.random,
  ): Promise<AvatarResponse> {
    const slots: ItemSlot[] = opts.slots?.length ? opts.slots : RANDOM_SLOTS;
    const owned = await this.prisma.userItem.findMany({
      where: { userId, item: { deletedAt: null, slot: { in: slots } } },
      select: { itemId: true, item: { select: { slot: true } } },
      orderBy: { acquiredAt: 'asc' },
    });
    const bySlot = new Map<ItemSlot, string[]>();
    for (const o of owned) {
      const list = bySlot.get(o.item.slot) ?? [];
      list.push(o.itemId);
      bySlot.set(o.item.slot, list);
    }
    const now = new Date();
    const writes: Prisma.PrismaPromise<unknown>[] = [...bySlot].map(
      ([slot, ids]) => {
        const itemId =
          ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))];
        return this.prisma.equippedItem.upsert({
          where: { userId_slot: { userId, slot } },
          create: { userId, slot, itemId },
          update: { itemId, updatedAt: now },
        });
      },
    );
    if (opts.look) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarConfig: true },
      });
      const look = randomAvatarConfig(rng, {
        skinTone: normalizeAvatarConfig(user.avatarConfig).skinTone,
      });
      writes.push(
        this.prisma.user.update({
          where: { id: userId },
          data: {
            avatarConfig: look as unknown as Prisma.InputJsonValue,
            avatarUpdatedAt: now,
          },
        }),
      );
    }
    if (writes.length) await this.prisma.$transaction(writes);
    return this.getAvatar(userId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Item name/description + category name in the caller's locale
   * (docs/11 §3) — one translations query for the whole response.
   */
  private async localizeItems(items: ItemResponse[]): Promise<void> {
    if (!this.localizer || items.length === 0) return;
    const tr = await this.localizer.localize([
      {
        entityType: 'ITEM',
        items: items.map((i) => ({
          id: i.id,
          values: { name: i.name, description: i.description },
        })),
      },
      {
        entityType: 'ITEM_CATEGORY',
        items: items.flatMap((i) =>
          i.categoryName != null
            ? [{ id: i.categorySlug, values: { name: i.categoryName } }]
            : [],
        ),
      },
    ]);
    for (const i of items) {
      tr.apply('ITEM', i.id, i, ['name', 'description']);
      if (i.categoryName != null)
        i.categoryName = tr.text(
          'ITEM_CATEGORY',
          i.categorySlug,
          'name',
          i.categoryName,
        );
    }
  }

  /** Equipped item names in the caller's locale. */
  private async localizeEquipped(
    map: AvatarResponse['equipped'],
  ): Promise<void> {
    const refs = Object.values(map).filter((r): r is EquippedRef => !!r);
    if (!this.localizer || refs.length === 0) return;
    const tr = await this.localizer.localize([
      {
        entityType: 'ITEM',
        items: refs.map((r) => ({ id: r.itemId, values: { name: r.name } })),
      },
    ]);
    for (const r of refs) tr.apply('ITEM', r.itemId, r, ['name']);
  }

  /** Asset-id sprite refs must point at an uploaded, confirmed Asset. */
  private async assertSpriteAssets(
    ...refs: (string | null | undefined)[]
  ): Promise<void> {
    const ids = refs.filter((r): r is string => isAssetSpriteRef(r));
    if (ids.length === 0) return;
    const found = await this.prisma.asset.findMany({
      where: { id: { in: ids }, confirmed: true },
      select: { id: true },
    });
    if (found.length < new Set(ids).size)
      throw new BadRequestException({
        code: 'item.sprite_asset_unknown',
        message: 'Sprite asset not found (upload and confirm it first)',
      });
  }

  /** Uploaded-sprite URLs for these items (one Asset query). */
  private spriteUrls(
    items: readonly Pick<Item, 'spriteAssetId'>[],
  ): Promise<SpriteUrlMap> {
    return loadSpriteUrls(
      this.prisma,
      items.map((i) => i.spriteAssetId),
    );
  }

  private async userContext(
    userId: string,
  ): Promise<{ coins: number; level: number; isPremium: boolean }> {
    const [user, isPremium] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { coins: true, totalXp: true },
      }),
      this.access.hasActiveSubscription(userId),
    ]);
    return { coins: user.coins, level: levelFromXp(user.totalXp), isPremium };
  }

  private async ownedItemIds(userId: string): Promise<Set<string>> {
    const owned = await this.prisma.userItem.findMany({
      where: { userId },
      select: { itemId: true },
    });
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

/**
 * The audited fields of an item (`diff.before` / `diff.after`): the stored
 * columns, without the derived sprite URL.
 */
export function itemAuditSnapshot(i: ItemResponse): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...i };
  delete stored['spriteUrl'];
  return stored;
}

export function toItemResponse(i: Item, urls: SpriteUrlMap): ItemResponse {
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
    spriteUrl: spriteUrlFor(i.spriteAssetId, urls),
    thumbnailAssetId: i.thumbnailAssetId,
    isActive: i.isActive,
  };
}

function assertDropWindow(w: Parameters<typeof validateDropWindow>[0]): void {
  const errors = validateDropWindow(w);
  if (errors.length) throw new BadRequestException(errors);
}

/** ITEM_DROP push copy (pt-BR / en-US). */
export function dropCopy(
  locale: string,
  item: Pick<Item, 'id' | 'name' | 'dropEndsAt'>,
) {
  const pt = locale.startsWith('pt');
  let body: string;
  if (item.dropEndsAt)
    body = pt
      ? 'Disponível por tempo limitado na loja.'
      : 'In the shop for a limited time.';
  else body = pt ? 'Já disponível na loja.' : 'Now available in the shop.';
  return {
    kind: 'ITEM_DROP' as const,
    title: pt
      ? `✨ Novo item limitado: ${item.name}`
      : `✨ Limited drop: ${item.name}`,
    body,
    data: { itemId: item.id, route: '/shop' },
  };
}
