import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ItemCategoriesAdminService } from './item-categories-admin.service.js';

const row = (items: number) => ({
  slug: 'hats',
  name: 'Hats',
  sortOrder: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  _count: { items },
});

function setup(items = 0) {
  const prisma = {
    itemCategory: {
      findMany: jest.fn(async () => [row(items)]),
      findUnique: jest.fn(async () => row(items)),
      create: jest.fn(async () => row(0)),
      update: jest.fn(async () => ({ ...row(items), name: 'Caps' })),
      delete: jest.fn(async () => ({})),
    },
  };
  return {
    svc: new ItemCategoriesAdminService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('ItemCategoriesAdminService', () => {
  it('lists with item counts', async () => {
    const { svc } = setup(3);
    expect((await svc.list())[0]).toMatchObject({ slug: 'hats', itemCount: 3 });
  });

  it('maps duplicate slugs to conflict.unique', async () => {
    const { svc, prisma } = setup();
    prisma.itemCategory.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      svc.create({ slug: 'hats', name: 'Hats' }),
    ).rejects.toMatchObject({ response: { code: 'conflict.unique' } });
  });

  it('updates name/sortOrder and returns before + after', async () => {
    const { svc, prisma } = setup();
    const out = await svc.update('hats', { name: ' Caps ' });
    expect(prisma.itemCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'hats' },
        data: { name: 'Caps' },
      }),
    );
    expect(out.before.name).toBe('Hats');
    expect(out.after.name).toBe('Caps');
  });

  it('refuses to delete a category in use', async () => {
    const { svc, prisma } = setup(2);
    await expect(svc.remove('hats')).rejects.toMatchObject({
      response: { code: 'ITEM_CATEGORY_IN_USE' },
    });
    expect(prisma.itemCategory.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused category', async () => {
    const { svc, prisma } = setup(0);
    await svc.remove('hats');
    expect(prisma.itemCategory.delete).toHaveBeenCalledWith({
      where: { slug: 'hats' },
    });
  });

  it('404s unknown slugs', async () => {
    const { svc, prisma } = setup();
    prisma.itemCategory.findUnique.mockResolvedValueOnce(null as never);
    await expect(svc.update('nope', { name: 'x' })).rejects.toThrow(
      'Item category not found',
    );
  });
});
