import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CoursesService } from './courses.service.js';

const admin: ApiUser = {
  userId: 'a1',
  clerkId: 'c',
  email: 'e',
  role: 'ADMIN',
  displayName: 'd',
};

const course = {
  id: 'c1',
  slug: 's',
  status: 'DRAFT',
  sourceLocale: 'en',
  difficulty: 1,
  estimatedMinutes: 10,
  isCapstone: false,
  coverAssetId: 'img-1',
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  authorId: 'a1',
  author: { displayName: 'A' },
  categories: [],
  _count: { modules: 0 },
};

function setup(asset: Record<string, unknown> | null) {
  const prisma = {
    // The transaction client is the mock itself.
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
    course: {
      findFirst: jest.fn(async () => course),
      findFirstOrThrow: jest.fn(async () => course),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => course),
    },
    asset: {
      findUnique: jest.fn(async () => asset),
      findMany: jest.fn(async () =>
        asset?.['confirmed'] ? [{ id: 'img-1', url: 'https://cdn/x.png' }] : [],
      ),
    },
    contentTranslation: { findMany: jest.fn(async () => []) },
    lesson: { count: jest.fn(async () => 0) },
  };
  return {
    svc: new CoursesService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('CoursesService cover', () => {
  it('sets a confirmed image as the cover and returns its URL', async () => {
    const { svc, prisma } = setup({
      confirmed: true,
      kind: 'IMAGE',
      mimeType: 'image/png',
    });
    const res = await svc.update(admin, 'c1', { coverAssetId: 'img-1' });
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { coverAssetId: 'img-1' },
    });
    expect(res).toMatchObject({
      coverAssetId: 'img-1',
      coverUrl: 'https://cdn/x.png',
    });
  });

  it.each([
    ['missing', null],
    ['unconfirmed', { confirmed: false, kind: 'IMAGE', mimeType: 'image/png' }],
    ['a sprite', { confirmed: true, kind: 'SPRITE', mimeType: 'image/png' }],
    [
      'not an image',
      { confirmed: true, kind: 'OTHER', mimeType: 'text/plain' },
    ],
  ])('rejects an asset that is %s', async (_, asset) => {
    const { svc, prisma } = setup(asset);
    await expect(
      svc.update(admin, 'c1', { coverAssetId: 'img-1' }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'INVALID_COVER_ASSET' }),
    });
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('null clears the cover without an asset lookup', async () => {
    const { svc, prisma } = setup(null);
    await svc.update(admin, 'c1', { coverAssetId: null });
    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { coverAssetId: null },
    });
  });
});
