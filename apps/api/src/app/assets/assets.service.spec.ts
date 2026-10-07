import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AssetsService } from './assets.service.js';
import {
  createAssetStorage,
  DevDiskAssetStorage,
  R2AssetStorage,
} from './asset-storage.js';
import { sniffMime } from './asset-rules.js';
import type { ApiUser } from '../auth/auth.types.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const teacher: ApiUser = {
  userId: 't1',
  clerkId: 'dev-teacher',
  email: 't@x',
  role: 'TEACHER',
  displayName: 'T',
};
const admin: ApiUser = { ...teacher, userId: 'a1', role: 'ADMIN' };

function fakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    asset: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { ...data, createdAt: new Date() };
        rows.set(data['id'] as string, r);
        return r;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.get(where.id) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const r = { ...rows.get(where.id), ...data };
          rows.set(where.id, r);
          return r;
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) =>
        rows.delete(where.id),
      ),
      findMany: jest.fn(async () => [...rows.values()]),
    },
  };
}

describe('sniffMime', () => {
  it('recognises accepted formats by magic number, not by name', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<svg xmlns="'))).toBeNull();
    expect(sniffMime(Buffer.from('<html>'))).toBeNull();
  });
});

describe('AssetsService (dev disk storage)', () => {
  let dir: string;
  let storage: DevDiskAssetStorage;
  let prisma: ReturnType<typeof fakePrisma>;
  let svc: AssetsService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'assets-'));
    storage = new DevDiskAssetStorage(dir, 'http://api.test/api', 'secret');
    prisma = fakePrisma();
    svc = new AssetsService(prisma as never, storage);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('presign → upload → confirm serves a verified image', async () => {
    const p = await svc.presign(teacher, {
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      filename: 'a.png',
    });
    expect(p.uploadUrl).toContain(`/assets/dev-upload/${p.assetId}?token=`);
    const token = new URL(p.uploadUrl).searchParams.get('token') ?? undefined;
    await svc.devUpload(p.assetId, token, PNG);
    const view = await svc.confirm(teacher, p.assetId);
    expect(view).toMatchObject({
      confirmed: true,
      mimeType: 'image/png',
      url: `http://api.test/api/assets/dev/${p.assetId}`,
    });
    await expect(svc.devServe(p.assetId)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
  });

  it('rejects SVG, disallowed types per kind, and oversized files at presign', async () => {
    await expect(
      svc.presign(teacher, {
        kind: 'IMAGE',
        mimeType: 'image/svg+xml',
        sizeBytes: 10,
        filename: 'x.svg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.presign(teacher, {
        kind: 'SPRITE',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        filename: 'x.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.presign(teacher, {
        kind: 'SPRITE',
        mimeType: 'image/png',
        sizeBytes: 2 * 1024 * 1024,
        filename: 'x.png',
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('deletes the upload when the bytes do not match the declared type', async () => {
    const p = await svc.presign(teacher, {
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: JPEG.length,
      filename: 'a.png',
    });
    const token = new URL(p.uploadUrl).searchParams.get('token') ?? undefined;
    await svc.devUpload(p.assetId, token, JPEG);
    await expect(svc.confirm(teacher, p.assetId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.rows.has(p.assetId)).toBe(false);
    await expect(storage.head(`image/x`)).resolves.toBeNull();
  });

  it('refuses dev uploads with a bad token or the wrong size', async () => {
    const p = await svc.presign(teacher, {
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      filename: 'a.png',
    });
    await expect(
      svc.devUpload(p.assetId, 'forged', PNG),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const token = new URL(p.uploadUrl).searchParams.get('token') ?? undefined;
    await expect(
      svc.devUpload(p.assetId, token, Buffer.concat([PNG, PNG])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm before upload is a 400; another teacher cannot confirm or delete', async () => {
    const p = await svc.presign(teacher, {
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      filename: 'a.png',
    });
    await expect(svc.confirm(teacher, p.assetId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const other = { ...teacher, userId: 't2' };
    await expect(svc.confirm(other, p.assetId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(other, p.assetId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(admin, p.assetId)).resolves.toBeUndefined();
  });

  it('never resolves a key outside the storage root', async () => {
    await expect(storage.write('../escape.png', PNG)).rejects.toThrow(
      'Invalid asset key',
    );
  });
});

describe('createAssetStorage', () => {
  it('uses R2 when configured, dev disk otherwise, and refuses production without R2', () => {
    const r2 = createAssetStorage({
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      R2_BUCKET_NAME: 'b',
      R2_PUBLIC_URL: 'https://cdn.example/',
    });
    expect(r2).toBeInstanceOf(R2AssetStorage);
    expect(r2.publicUrl({ key: 'image/2026/10/x.png', assetId: 'x' })).toBe(
      'https://cdn.example/image/2026/10/x.png',
    );
    expect(
      createAssetStorage({ NODE_ENV: 'development', ASSET_DEV_DIR: tmpdir() }),
    ).toBeInstanceOf(DevDiskAssetStorage);
    expect(() => createAssetStorage({ NODE_ENV: 'production' })).toThrow(
      /R2_ACCOUNT_ID/,
    );
  });

  it('R2 presign signs content type and length', async () => {
    const sign = jest.fn(async () => 'https://signed');
    const storage = new R2AssetStorage(
      { send: jest.fn() } as never,
      'bucket',
      'https://cdn',
      sign as never,
    );
    const out = await storage.presignPut({
      assetId: 'x',
      key: 'k',
      mimeType: 'image/png',
      sizeBytes: 12,
      expiresInSec: 900,
    });
    expect(out).toEqual({
      url: 'https://signed',
      headers: { 'Content-Type': 'image/png' },
    });
    const [, cmd, opts] = sign.mock.calls[0] as unknown as [
      unknown,
      { input: Record<string, unknown> },
      { signableHeaders: Set<string>; expiresIn: number },
    ];
    expect(cmd.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'k',
      ContentType: 'image/png',
      ContentLength: 12,
    });
    expect([...opts.signableHeaders]).toEqual([
      'content-type',
      'content-length',
    ]);
    expect(opts.expiresIn).toBe(900);
  });
});
