import { NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service.js';
import { ItemsController } from './items.controller.js';

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

const actor = { userId: 'a1', role: 'ADMIN' } as never;

function setup() {
  const prisma = {
    item: {
      findFirst: jest.fn(async (): Promise<unknown> => item()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const merged: Record<string, unknown> = item();
        for (const [k, v] of Object.entries(data))
          if (v !== undefined) merged[k] = v;
        return merged;
      }),
    },
    asset: { findMany: jest.fn(async () => []) },
  };
  // Reflect.construct: robust to optional constructor deps being added.
  const svc: ItemsService = Reflect.construct(ItemsService, [
    prisma,
    {},
    {},
    {},
  ]);
  const audit = {
    record: jest.fn<Promise<void>, [unknown, unknown]>(async () => undefined),
  };
  // Starter-pet / pet-name services are not used by the admin routes.
  const ctrl: ItemsController = Reflect.construct(ItemsController, [
    svc,
    audit,
    {},
    {},
  ]);
  return { prisma, ctrl, audit };
}

describe('Item audit before-state (SEC-3)', () => {
  it('PATCH audits the item before and after the change', async () => {
    const { ctrl, audit } = setup();
    const res = await ctrl.updateItem(actor, 'i1', {
      costCoins: 80,
      name: 'Silk Hat',
    });
    expect(res).toEqual(
      expect.objectContaining({ id: 'i1', costCoins: 80, name: 'Silk Hat' }),
    );
    expect(audit.record).toHaveBeenCalledWith(actor, {
      action: 'item.update',
      entity: 'Item',
      entityId: 'i1',
      before: expect.objectContaining({ costCoins: 50, name: 'Top Hat' }),
      after: expect.objectContaining({ costCoins: 80, name: 'Silk Hat' }),
    });
    const { before } = audit.record.mock.calls[0][1] as {
      before: Record<string, unknown>;
    };
    expect(before).not.toHaveProperty('spriteUrl');
  });

  it('DELETE soft-deletes and audits the item as it was', async () => {
    const { ctrl, audit, prisma } = setup();
    await ctrl.removeItem(actor, 'i1');
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { deletedAt: expect.any(Date), isActive: false },
    });
    expect(audit.record).toHaveBeenCalledWith(actor, {
      action: 'item.delete',
      entity: 'Item',
      entityId: 'i1',
      before: expect.objectContaining({
        slug: 'hat',
        costCoins: 50,
        isActive: true,
      }),
    });
  });

  it('an unknown item is a 404 and writes no audit row', async () => {
    const { ctrl, audit, prisma } = setup();
    prisma.item.findFirst.mockResolvedValueOnce(null);
    await expect(ctrl.removeItem(actor, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
