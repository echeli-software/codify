import { BadRequestException } from '@nestjs/common';
import { ItemDropsService, renderDropCopy } from './item-drops.service.js';

const copy = {
  'pt-BR': { title: 'Novo: {item}', body: 'Corra!' },
  'en-US': { title: 'New: {item}', body: 'Hurry!' },
};

function fakePrisma(items: string[]) {
  const tx = {
    item: { updateMany: jest.fn(async () => ({ count: items.length })) },
    contentTranslation: { upsert: jest.fn(async () => ({})) },
    idempotencyRecord: { deleteMany: jest.fn(async () => ({ count: 0 })) },
  };
  return {
    tx,
    item: {
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => items.includes(id)).map((id) => ({ id })),
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
}

describe('renderDropCopy', () => {
  it('fills the {item} placeholder', () => {
    expect(renderDropCopy(copy['en-US'], 'Hat')).toEqual({
      title: 'New: Hat',
      body: 'Hurry!',
    });
  });
});

describe('ItemDropsService.schedule', () => {
  const now = new Date('2026-11-08T12:00:00Z');

  it('sets the window, stores copy per locale and re-arms future announcements', async () => {
    const prisma = fakePrisma(['i1', 'i2']);
    const svc = new ItemDropsService(prisma as never);
    const res = await svc.schedule(
      {
        itemIds: ['i1', 'i2', 'i1'],
        startsAt: '2026-11-09T12:00:00Z',
        endsAt: '2026-11-10T12:00:00Z',
        copy,
      },
      now,
    );
    expect(res.itemIds).toEqual(['i1', 'i2']);
    expect(res.reannounce).toEqual(['i1', 'i2']);
    expect(prisma.tx.item.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isLimitedDrop: true }),
      }),
    );
    // 2 items × 2 locales × (title, body)
    expect(prisma.tx.contentTranslation.upsert).toHaveBeenCalledTimes(8);
    expect(prisma.tx.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['item_drop:i1', 'item_drop:i2'] } },
    });
  });

  it('rejects bad windows and unknown items', async () => {
    const svc = new ItemDropsService(fakePrisma(['i1']) as never);
    await expect(
      svc.schedule(
        {
          itemIds: ['i1'],
          startsAt: '2026-11-09T00:00:00Z',
          endsAt: '2026-11-08T00:00:00Z',
          copy,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.schedule(
        {
          itemIds: ['i1', 'nope'],
          startsAt: '2026-11-09T00:00:00Z',
          endsAt: null,
          copy,
        },
        now,
      ),
    ).rejects.toThrow('not found');
  });
});
