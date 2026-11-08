import { createHash } from 'node:crypto';

/** Hex sha256 of an uploaded object (dedupe key, docs/02 Asset). */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Pixel dimensions from the image header (PNG, JPEG, GIF, WebP), or null
 * when the bytes are not a recognised image. Header-only parsing — no
 * decoding — so it is cheap and safe on untrusted input.
 */
export function imageDimensions(
  buf: Buffer,
): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // PNG: signature, then IHDR width/height (big-endian) at 16/20.
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
    return ok(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  // GIF: logical screen width/height (little-endian) at 6/8.
  if (/^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) {
    return ok(buf.readUInt16LE(6), buf.readUInt16LE(8));
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    const chunk = buf.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X' && buf.length >= 30)
      return ok(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21);
      return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8 ' && buf.length >= 30)
      return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    return null;
  }
  // JPEG: walk the markers to the first SOFn frame header.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1; // fill byte
        continue;
      }
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2; // standalone markers
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) return ok(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

function ok(width: number, height: number) {
  return width > 0 && height > 0 ? { width, height } : null;
}
