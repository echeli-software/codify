import type { ItemSlot } from '@prisma/client';
import type { AccessService } from '../billing/access.service.js';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { UserPushService } from '../gamification/user-push.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ItemsService } from './items.service.js';

/**
 * LRN-2 (docs/16 §8): per-slot last-write-wins for offline avatar equips,
 * with an `AvatarSlotTombstone` so an unequip is not forgotten. Runs the
 * real service against a small in-memory store of the three tables.
 */

const USER = 'u1';
const OWNED: Record<string, ItemSlot> = { h1: 'HAT', h2: 'HAT', p1: 'PET' };

interface Row {
  itemId: string;
  updatedAt: Date;
}

function fakeDb() {
  const equipped = new Map<ItemSlot, Row>();
  const tombstones = new Map<ItemSlot, Date>();
  const key = (w: { userId_slot: { slot: ItemSlot } }) => w.userId_slot.slot;
  const lte = (d: Date, w?: { lte: Date }) =>
    !w || d.getTime() <= w.lte.getTime();
  const prisma = {
    equippedItem: {
      findUnique: jest.fn(
        async (a: { where: { userId_slot: { slot: ItemSlot } } }) => {
          const r = equipped.get(key(a.where));
          return r ? { updatedAt: r.updatedAt } : null;
        },
      ),
      upsert: jest.fn(
        async (a: {
          where: { userId_slot: { slot: ItemSlot } };
          create: { itemId: string; updatedAt?: Date };
          update: { itemId: string; updatedAt?: Date };
        }) => {
          const slot = key(a.where);
          const data = equipped.has(slot) ? a.update : a.create;
          equipped.set(slot, {
            itemId: data.itemId,
            updatedAt: data.updatedAt ?? new Date(),
          });
        },
      ),
      deleteMany: jest.fn(
        async (a: { where: { slot: ItemSlot; updatedAt?: { lte: Date } } }) => {
          const r = equipped.get(a.where.slot);
          if (!r || !lte(r.updatedAt, a.where.updatedAt)) return { count: 0 };
          equipped.delete(a.where.slot);
          return { count: 1 };
        },
      ),
    },
    avatarSlotTombstone: {
      findUnique: jest.fn(
        async (a: { where: { userId_slot: { slot: ItemSlot } } }) => {
          const t = tombstones.get(key(a.where));
          return t ? { clearedAt: t } : null;
        },
      ),
      upsert: jest.fn(
        async (a: {
          where: { userId_slot: { slot: ItemSlot } };
          create: { clearedAt: Date };
          update: { clearedAt: Date };
        }) => {
          const slot = key(a.where);
          tombstones.set(
            slot,
            tombstones.has(slot) ? a.update.clearedAt : a.create.clearedAt,
          );
        },
      ),
      deleteMany: jest.fn(
        async (a: { where: { slot: ItemSlot; clearedAt: { lte: Date } } }) => {
          const t = tombstones.get(a.where.slot);
          if (!t || !lte(t, a.where.clearedAt)) return { count: 0 };
          tombstones.delete(a.where.slot);
          return { count: 1 };
        },
      ),
    },
    userItem: {
      findUnique: jest.fn(
        async (a: { where: { userId_itemId: { itemId: string } } }) => {
          const slot = OWNED[a.where.userId_itemId.itemId];
          return slot ? { item: { slot } } : null;
        },
      ),
    },
  };
  const $transaction = jest.fn(
    async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: { ...prisma, $transaction }, equipped, tombstones };
}

function setup() {
  const db = fakeDb();
  const svc = new ItemsService(
    db.prisma as unknown as PrismaService,
    {} as GamificationService,
    {} as UserPushService,
    {} as AccessService,
  );
  // The avatar read is not under test: report the slots' current items.
  jest.spyOn(svc, 'getAvatar').mockImplementation(async () => ({
    config: null,
    equipped: Object.fromEntries(
      [...db.equipped].map(([slot, r]) => [slot, { itemId: r.itemId }]),
    ) as never,
  }));
  const at = (min: number) =>
    new Date(Date.UTC(2026, 10, 8, 10, min)).toISOString();
  const equip = (slot: ItemSlot, itemId: string | null, min?: number) =>
    svc.equip(USER, slot, itemId, min === undefined ? undefined : at(min));
  const hat = () => db.equipped.get('HAT')?.itemId ?? null;
  return { ...db, svc, equip, hat, at };
}

describe('offline avatar equips: per-slot LWW with unequip tombstones', () => {
  it('equip@1 → unequip@2 replayed in order leaves the slot empty', async () => {
    const t = setup();
    await t.equip('HAT', 'h1', 1);
    const res = await t.equip('HAT', null, 2);
    expect(res.stale).toBeUndefined();
    expect(t.hat()).toBeNull();
    expect(t.tombstones.get('HAT')?.toISOString()).toBe(t.at(2));
  });

  it('equip@1 → unequip@2 replayed out of order still ends empty', async () => {
    const t = setup();
    await t.equip('HAT', null, 2);
    const res = await t.equip('HAT', 'h1', 1);
    expect(res.stale).toBe(true);
    expect(t.hat()).toBeNull();
  });

  it('an older queued equip loses to a live unequip made since', async () => {
    const t = setup();
    await t.equip('HAT', 'h1'); // live, now
    await t.equip('HAT', null); // live unequip, now
    const res = await t.equip('HAT', 'h2', 1); // queued long ago
    expect(res.stale).toBe(true);
    expect(t.hat()).toBeNull();
  });

  it('unequip@1 → equip@2 in either order ends equipped', async () => {
    for (const order of [
      [null, 'h1'],
      ['h1', null],
    ] as const) {
      const t = setup();
      for (const item of order)
        await t.equip('HAT', item, item === null ? 1 : 2);
      expect(t.hat()).toBe('h1');
      // In order the equip removes the tombstone; out of order the late
      // unequip leaves one older than the equip, which never blocks it.
      const cleared = t.tombstones.get('HAT');
      if (order[0] === null) expect(cleared).toBeUndefined();
      else expect(cleared?.toISOString()).toBe(t.at(1));
    }
  });

  it('a stale unequip keeps the newer equip but still records its time', async () => {
    const t = setup();
    await t.equip('HAT', 'h1', 5);
    const res = await t.equip('HAT', null, 3);
    expect(res.stale).toBe(true);
    expect(t.hat()).toBe('h1');
    // An equip between the two stays stale against the row.
    expect((await t.equip('HAT', 'h2', 4)).stale).toBe(true);
    expect(t.hat()).toBe('h1');
  });

  it('the tombstone keeps the latest unequip time (max)', async () => {
    const t = setup();
    await t.equip('HAT', null, 6);
    await t.equip('HAT', null, 2);
    expect(t.tombstones.get('HAT')?.toISOString()).toBe(t.at(6));
    expect((await t.equip('HAT', 'h1', 4)).stale).toBe(true);
    expect(t.hat()).toBeNull();
    await t.equip('HAT', 'h1', 7);
    expect(t.hat()).toBe('h1');
  });

  it('equip@1, equip@3, unequip@2 in any order ends on the @3 equip', async () => {
    const writes = [
      ['h1', 1],
      ['h2', 3],
      [null, 2],
    ] as const;
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      const t = setup();
      for (const i of order) {
        const [item, min] = writes[i] ?? [];
        await t.equip('HAT', item ?? null, min);
      }
      expect([order, t.hat()]).toEqual([order, 'h2']);
    }
  });

  it('a tombstone on one slot never blocks another slot', async () => {
    const t = setup();
    await t.equip('HAT', null, 5);
    expect((await t.equip('PET', 'p1', 1)).stale).toBeUndefined();
    expect(t.equipped.get('PET')?.itemId).toBe('p1');
  });

  it('a live unequip always removes the item, whatever its time', async () => {
    const t = setup();
    await t.equip('HAT', 'h1', 5);
    await t.equip('HAT', null);
    expect(t.hat()).toBeNull();
  });
});
