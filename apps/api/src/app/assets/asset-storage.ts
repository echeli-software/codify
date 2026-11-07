import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const ASSET_STORAGE = Symbol('ASSET_STORAGE');

export interface PresignInput {
  assetId: string;
  key: string;
  mimeType: string;
  sizeBytes: number;
  expiresInSec: number;
}

export interface AssetStorage {
  readonly mode: 'r2' | 'dev';
  /** URL + headers the client PUTs the file to. */
  presignPut(
    input: PresignInput,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** Object size, or null when nothing was uploaded. */
  head(key: string): Promise<{ size: number } | null>;
  /** First `bytes` bytes, for magic-number sniffing. */
  readPrefix(key: string, bytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Public (CDN) URL clients render. */
  publicUrl(ref: { key: string; assetId: string }): string;
}

type Env = Record<string, string | undefined>;

/**
 * Cloudflare R2 through its S3-compatible API (docs/13 §R2). The presigned
 * PUT signs Content-Type and Content-Length, so the upload must match what
 * was declared at presign time.
 */
export class R2AssetStorage implements AssetStorage {
  readonly mode = 'r2' as const;
  constructor(
    private readonly s3: Pick<S3Client, 'send'>,
    private readonly bucket: string,
    private readonly publicBase: string,
    private readonly sign: typeof getSignedUrl = getSignedUrl,
  ) {}

  async presignPut(input: PresignInput) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.mimeType,
      ContentLength: input.sizeBytes,
    });
    const url = await this.sign(this.s3 as S3Client, cmd, {
      expiresIn: input.expiresInSec,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': input.mimeType } };
  }

  async head(key: string) {
    try {
      const out = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: Number(out.ContentLength ?? 0) };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string }).name === 'NotFound')
        return null;
      throw err;
    }
  }

  async readPrefix(key: string, bytes: number) {
    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    const body = out.Body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    return Buffer.from(
      body?.transformToByteArray ? await body.transformToByteArray() : [],
    );
  }

  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl({ key }: { key: string }) {
    return `${this.publicBase.replace(/\/+$/, '')}/${key}`;
  }
}

/**
 * Dev storage on local disk so the presign → PUT → confirm flow works with no
 * cloud account. Uploads go to `PUT /api/assets/dev-upload/:id?token=…`
 * (token = HMAC of the asset id) and are served from `GET /api/assets/dev/:id`.
 */
export class DevDiskAssetStorage implements AssetStorage {
  readonly mode = 'dev' as const;
  constructor(
    private readonly root: string,
    private readonly apiBase: string,
    private readonly secret: string,
  ) {}

  uploadToken(assetId: string): string {
    return createHmac('sha256', this.secret)
      .update(assetId)
      .digest('base64url');
  }

  verifyToken(assetId: string, token: string | undefined): boolean {
    if (!token) return false;
    const want = Buffer.from(this.uploadToken(assetId));
    const got = Buffer.from(token);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async presignPut(input: PresignInput) {
    const url = `${this.apiBase}/assets/dev-upload/${input.assetId}?token=${this.uploadToken(input.assetId)}`;
    return { url, headers: { 'Content-Type': input.mimeType } };
  }

  async write(key: string, data: Buffer): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async head(key: string) {
    try {
      const s = await stat(this.pathFor(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, bytes: number) {
    return (await readFile(this.pathFor(key))).subarray(0, bytes);
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  publicUrl({ assetId }: { assetId: string }) {
    return `${this.apiBase}/assets/dev/${assetId}`;
  }

  /** Keys are server-generated, but never let one escape the root. */
  private pathFor(key: string): string {
    const root = resolve(this.root);
    const file = resolve(join(root, key));
    if (!file.startsWith(root + sep)) throw new Error('Invalid asset key');
    return file;
  }
}

/**
 * R2 when its four variables are set; dev disk otherwise, except in
 * production, which refuses to boot without R2 (brief §4).
 */
export function createAssetStorage(env: Env): AssetStorage {
  const account = env['R2_ACCOUNT_ID'];
  const keyId = env['R2_ACCESS_KEY_ID'];
  const secret = env['R2_SECRET_ACCESS_KEY'];
  const bucket = env['R2_BUCKET_NAME'];
  const publicUrl = env['R2_PUBLIC_URL'];
  if (account && keyId && secret && bucket && publicUrl) {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    });
    return new R2AssetStorage(s3, bucket, publicUrl);
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      'Asset storage is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_URL in production',
    );
  }
  const apiBase =
    env['API_PUBLIC_URL']?.replace(/\/+$/, '') ??
    `http://localhost:${env['API_PORT'] || env['PORT'] || 3000}/api`;
  const root = env['ASSET_DEV_DIR'] || resolve('apps/api/uploads');
  new Logger('AssetsModule').log(
    `R2 not configured — storing uploads under ${root}`,
  );
  return new DevDiskAssetStorage(
    root,
    apiBase,
    env['DEV_ASSET_SECRET'] ||
      createHmac('sha256', String(Date.now() + Math.random())).digest('hex'),
  );
}
