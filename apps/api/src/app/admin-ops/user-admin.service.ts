import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import type {
  GrantItemResponse,
  LedgerEntryView,
  LedgerPage,
  LedgerType,
  UserInventoryEntry,
} from './admin-ops.dto.js';
import { decodeCursor, olderThan, toPage } from './admin-ops.util.js';

const ITEM_SELECT = {
  id: true,
  slug: true,
  name: true,
  slot: true,
  rarity: true,
  categorySlug: true,
  spriteAssetId: true,
} as const;

type InventoryRow = {
  source: string;
  acquiredAt: Date;
  item: {
    id: string;
    slug: string;
    name: string;
    slot: string;
    rarity: string;
    categorySlug: string;
    spriteAssetId: string;
  };
};

function toEntry(r: InventoryRow, equipped: Set<string>): UserInventoryEntry {
  return {
    itemId: r.item.id,
    slug: r.item.slug,
    name: r.item.name,
    slot: r.item.slot,
    rarity: r.item.rarity,
    categorySlug: r.item.categorySlug,
    spriteAssetId: r.item.spriteAssetId,
    source: r.source,
    acquiredAt: r.acquiredAt.toISOString(),
    equipped: equipped.has(r.item.id),
  };
}

/**
 * User detail tabs (docs/04 "Users"): inventory with a manual grant
 * (ItemAcquisitionSource.ADMIN_GRANT, idempotent) and the coin / XP
 * ledgers with the balance after each row.
 */
@Injectable()
export class UserAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }

  async inventory(userId: string): Promise<UserInventoryEntry[]> {
    await this.assertUser(userId);
    const [rows, equipped] = await Promise.all([
      this.prisma.userItem.findMany({
        where: { userId },
        orderBy: { acquiredAt: 'desc' },
        select: {
          source: true,
          acquiredAt: true,
          item: { select: ITEM_SELECT },
        },
      }),
      this.prisma.equippedItem.findMany({
        where: { userId },
        select: { itemId: true },
      }),
    ]);
    const eq = new Set(equipped.map((e) => e.itemId));
    return rows.map((r) => toEntry(r, eq));
  }

  /**
   * Grant an item. Already owned → the existing row with
   * `alreadyOwned: true` and nothing written (the caller audits only real
   * grants). A concurrent duplicate grant resolves the same way.
   */
  async grantItem(userId: string, itemId: string): Promise<GrantItemResponse> {
    await this.assertUser(userId);
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, deletedAt: null },
      select: { id: true },
    });
    if (!item)
      throw new NotFoundException({
        code: 'ITEM_NOT_FOUND',
        message: 'Item not found',
      });
    const existing = await this.findOwned(userId, itemId);
    if (existing) return { entry: existing, alreadyOwned: true };
    try {
      await this.prisma.userItem.create({
        data: { userId, itemId, source: 'ADMIN_GRANT' },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.findOwned(userId, itemId);
      if (raced) return { entry: raced, alreadyOwned: true };
      throw err;
    }
    const created = await this.findOwned(userId, itemId);
    if (!created) throw new NotFoundException('Item grant not found');
    return { entry: created, alreadyOwned: false };
  }

  private async findOwned(
    userId: string,
    itemId: string,
  ): Promise<UserInventoryEntry | null> {
    const row = await this.prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      select: { source: true, acquiredAt: true, item: { select: ITEM_SELECT } },
    });
    if (!row) return null;
    const equipped = await this.prisma.equippedItem.findFirst({
      where: { userId, itemId },
      select: { itemId: true },
    });
    return toEntry(row, new Set(equipped ? [itemId] : []));
  }

  async ledger(
    userId: string,
    type: LedgerType,
    rawCursor: string | undefined,
    limit = 25,
  ): Promise<LedgerPage> {
    await this.assertUser(userId);
    const cursor = decodeCursor(rawCursor);
    return type === 'coins'
      ? this.coinLedger(userId, cursor, limit)
      : this.xpLedger(userId, cursor, limit);
  }

  private async coinLedger(
    userId: string,
    cursor: ReturnType<typeof decodeCursor>,
    limit: number,
  ): Promise<LedgerPage> {
    const [rows, user] = await Promise.all([
      this.prisma.coinTransaction.findMany({
        where: { userId, ...olderThan(cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { coins: true },
      }),
    ]);
    return {
      type: 'coins',
      balance: user?.coins ?? 0,
      ...toPage(rows, limit, (r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        delta: r.delta,
        balanceAfter: r.balanceAfter,
        source: r.source,
        multiplier: r.multiplier?.toString() ?? null,
        refType: r.refType,
        refId: r.refId,
      })),
    };
  }

  /**
   * XpEvent has no stored running total, so `balanceAfter` is the journal
   * sum up to and including each row: one aggregate for the page's newest
   * row, then subtract downwards.
   */
  private async xpLedger(
    userId: string,
    cursor: ReturnType<typeof decodeCursor>,
    limit: number,
  ): Promise<LedgerPage> {
    const rows = await this.prisma.xpEvent.findMany({
      where: { userId, ...olderThan(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const [total, upToFirst] = await Promise.all([
      this.prisma.xpEvent.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
      rows[0]
        ? this.prisma.xpEvent.aggregate({
            where: { userId, ...notNewerThan(rows[0]) },
            _sum: { amount: true },
          })
        : null,
    ]);
    let running = upToFirst?._sum.amount ?? 0;
    const page = toPage(rows, limit, (r): LedgerEntryView => {
      const entry = {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        delta: r.amount,
        balanceAfter: running,
        source: r.source,
        multiplier: r.multiplier?.toString() ?? null,
        refType: r.refType,
        refId: r.refId,
      };
      running -= r.amount;
      return entry;
    });
    return { type: 'xp', balance: total._sum.amount ?? 0, ...page };
  }
}

/** Rows at or before `row` in (createdAt, id) order. */
function notNewerThan(row: {
  createdAt: Date;
  id: string;
}): Prisma.XpEventWhereInput {
  return {
    OR: [
      { createdAt: { lt: row.createdAt } },
      { createdAt: row.createdAt, id: { lte: row.id } },
    ],
  };
}
