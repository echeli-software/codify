import { imageDimensions, sha256Hex } from './image-meta.js';

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe('imageDimensions', () => {
  it('reads PNG, GIF, JPEG and WebP headers', () => {
    expect(imageDimensions(png(1200, 630))).toEqual({
      width: 1200,
      height: 630,
    });

    const gif = Buffer.alloc(24);
    gif.write('GIF89a', 0, 'latin1');
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(240, 8);
    expect(imageDimensions(gif)).toEqual({ width: 320, height: 240 });

    // SOI, APP0 (len 16), SOF0 with height 480, width 800.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(14),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x03, 0x20]),
      Buffer.alloc(12),
    ]);
    expect(imageDimensions(jpeg)).toEqual({ width: 800, height: 480 });

    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBP', 8, 'latin1');
    webp.write('VP8X', 12, 'latin1');
    webp.writeUIntLE(1919, 24, 3);
    webp.writeUIntLE(1079, 27, 3);
    expect(imageDimensions(webp)).toEqual({ width: 1920, height: 1080 });
  });

  it('returns null for non-images and truncated headers', () => {
    expect(
      imageDimensions(Buffer.from('%PDF-1.7 some pdf bytes here')),
    ).toBeNull();
    expect(imageDimensions(png(10, 10).subarray(0, 20))).toBeNull();
    expect(imageDimensions(png(0, 10))).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('hashes bytes to lowercase hex', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
