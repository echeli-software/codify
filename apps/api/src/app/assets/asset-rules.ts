import type { AssetKind } from '@prisma/client';

const MB = 1024 * 1024;

/** Allowed MIME types and size caps per asset kind (docs/14 §3). SVG is never accepted. */
export const ASSET_RULES: Record<
  AssetKind,
  { mimeTypes: string[]; maxBytes: number }
> = {
  IMAGE: {
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    maxBytes: 5 * MB,
  },
  COVER: {
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 8 * MB,
  },
  SPRITE: { mimeTypes: ['image/png', 'image/webp'], maxBytes: 1 * MB },
  OTHER: { mimeTypes: ['application/pdf'], maxBytes: 10 * MB },
};

export const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** Bytes needed by {@link sniffMime}. */
export const SNIFF_BYTES = 16;

/**
 * Detect the real type from magic numbers, independent of what the client
 * declared or what the file is named. Returns null for anything we don't
 * accept.
 */
export function sniffMime(buf: Buffer): string | null {
  const b = (i: number) => buf[i];
  if (
    buf.length >= 8 &&
    b(0) === 0x89 &&
    buf.subarray(1, 4).toString('latin1') === 'PNG'
  )
    return 'image/png';
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff)
    return 'image/jpeg';
  if (
    buf.length >= 6 &&
    /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))
  )
    return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  return null;
}
