import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Asset, AssetKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ASSET_RULES,
  EXTENSION,
  SNIFF_BYTES,
  sniffMime,
} from './asset-rules.js';
import {
  ASSET_STORAGE,
  DevDiskAssetStorage,
  type AssetStorage,
} from './asset-storage.js';
import type {
  AssetView,
  PresignAssetDto,
  PresignAssetResponse,
} from './assets.dto.js';

const PRESIGN_TTL_SEC = 15 * 60;

/**
 * Media uploads (docs/14 §3): the client asks for a presigned URL, PUTs the
 * file straight to storage, then confirms. Confirmation checks the stored
 * object's size and sniffs its magic bytes against the declared type; a
 * mismatch deletes the object. Only confirmed assets are listed or served.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  async presign(
    actor: ApiUser,
    input: PresignAssetDto,
    now = new Date(),
  ): Promise<PresignAssetResponse> {
    const mimeType = input.mimeType.toLowerCase().trim();
    if (mimeType === 'image/svg+xml') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ASSET_TYPE_NOT_ALLOWED',
        message: 'SVG uploads are not accepted',
      });
    }
    const rule = ASSET_RULES[input.kind];
    if (!rule.mimeTypes.includes(mimeType)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ASSET_TYPE_NOT_ALLOWED',
        message: `${input.kind} accepts ${rule.mimeTypes.join(', ')}`,
      });
    }
    if (input.sizeBytes > rule.maxBytes) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        code: 'ASSET_TOO_LARGE',
        message: `${input.kind} files are limited to ${rule.maxBytes} bytes`,
      });
    }

    const id = randomUUID();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `${input.kind.toLowerCase()}/${yyyy}/${mm}/${id}.${EXTENSION[mimeType]}`;
    const url = this.storage.publicUrl({ key, assetId: id });
    await this.prisma.asset.create({
      data: {
        id,
        key,
        url,
        mimeType,
        sizeBytes: input.sizeBytes,
        kind: input.kind,
        confirmed: false,
        uploadedById: actor.userId,
      },
    });
    const put = await this.storage.presignPut({
      assetId: id,
      key,
      mimeType,
      sizeBytes: input.sizeBytes,
      expiresInSec: PRESIGN_TTL_SEC,
    });
    return {
      assetId: id,
      uploadUrl: put.url,
      headers: put.headers,
      url,
      expiresAt: new Date(now.getTime() + PRESIGN_TTL_SEC * 1000).toISOString(),
    };
  }

  async confirm(actor: ApiUser, id: string): Promise<AssetView> {
    const asset = await this.ownedAsset(actor, id);
    if (asset.confirmed) return toView(asset);

    const head = await this.storage.head(asset.key);
    if (!head) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ASSET_NOT_UPLOADED',
        message: 'Upload the file before confirming',
      });
    }
    const sniffed = sniffMime(
      await this.storage.readPrefix(asset.key, SNIFF_BYTES),
    );
    if (head.size !== asset.sizeBytes || sniffed !== asset.mimeType) {
      await this.storage.delete(asset.key);
      await this.prisma.asset.delete({ where: { id } });
      throw new BadRequestException({
        statusCode: 400,
        code: 'ASSET_CONTENT_MISMATCH',
        message:
          head.size !== asset.sizeBytes
            ? 'Uploaded size does not match the declared size'
            : 'File contents do not match the declared type',
      });
    }
    const updated = await this.prisma.asset.update({
      where: { id },
      data: { confirmed: true },
    });
    return toView(updated);
  }

  async list(opts: {
    kind?: AssetKind;
    cursor?: string;
    limit?: number;
  }): Promise<{
    items: AssetView[];
    nextCursor: string | null;
  }> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const rows = await this.prisma.asset.findMany({
      where: { confirmed: true, ...(opts.kind ? { kind: opts.kind } : {}) },
      orderBy: { id: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    return {
      items: page.map(toView),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  async remove(actor: ApiUser, id: string): Promise<void> {
    const asset = await this.ownedAsset(actor, id);
    await this.storage.delete(asset.key);
    await this.prisma.asset.delete({ where: { id } });
  }

  // ─── Dev storage only ───────────────────────────────────────────────────

  async devUpload(
    id: string,
    token: string | undefined,
    body: Buffer,
  ): Promise<void> {
    const dev = this.devStorage();
    if (!dev.verifyToken(id, token))
      throw new ForbiddenException('Invalid upload token');
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.confirmed)
      throw new NotFoundException('Asset not found');
    if (body.length !== asset.sizeBytes) {
      throw new BadRequestException(
        'Upload size does not match the declared size',
      );
    }
    await dev.write(asset.key, body);
  }

  async devServe(id: string): Promise<{ mimeType: string; data: Buffer }> {
    const dev = this.devStorage();
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || !asset.confirmed)
      throw new NotFoundException('Asset not found');
    return { mimeType: asset.mimeType, data: await dev.read(asset.key) };
  }

  /** Max bytes the dev upload route should read for this asset. */
  async devExpectedSize(id: string): Promise<number> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { sizeBytes: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset.sizeBytes;
  }

  private devStorage(): DevDiskAssetStorage {
    if (!(this.storage instanceof DevDiskAssetStorage)) {
      throw new NotFoundException();
    }
    return this.storage;
  }

  /** ADMIN may act on any asset; a TEACHER only on their own uploads. */
  private async ownedAsset(actor: ApiUser, id: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (actor.role !== 'ADMIN' && asset.uploadedById !== actor.userId) {
      throw new ForbiddenException('Not your upload');
    }
    return asset;
  }
}

function toView(a: Asset): AssetView {
  return {
    id: a.id,
    kind: a.kind,
    url: a.url,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    confirmed: a.confirmed,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt.toISOString(),
  };
}
