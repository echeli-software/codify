import {
  LEGACY_SERIAL_PATTERN,
  SERIAL_PATTERN_V2,
  encodeSerial,
  formatSerial,
  isCourseComplete,
  isValidSerial,
  normalizeSerial,
} from './certificates.js';

describe('isCourseComplete', () => {
  it('true only when all lessons are finished and there is at least one', () => {
    expect(isCourseComplete(5, 5)).toBe(true);
    expect(isCourseComplete(5, 6)).toBe(true); // defensive: never under-issue
    expect(isCourseComplete(5, 4)).toBe(false);
    expect(isCourseComplete(0, 0)).toBe(false);
  });
});

describe('formatSerial / isValidSerial', () => {
  it('formats raw entropy into CDFY-XXXX-XXXX', () => {
    const s = formatSerial('ab12cd34ef');
    expect(s).toBe('CDFY-AB12-CD34');
    expect(isValidSerial(s)).toBe(true);
  });

  it('drops ambiguous characters (I/O/L) and pads short input', () => {
    expect(isValidSerial(formatSerial('IOL9'))).toBe(true); // I/O/L removed, padded
    expect(formatSerial('')).toBe('CDFY-0000-0000');
  });

  it('rejects malformed serials', () => {
    expect(isValidSerial('CDFY-AB12-CD34')).toBe(true);
    expect(isValidSerial('XXXX-AB12-CD34')).toBe(false);
    expect(isValidSerial('CDFY-AB12')).toBe(false);
    expect(isValidSerial('cdfy-ab12-cd34')).toBe(false);
    expect(isValidSerial('CDFY-AB12-CD34-EF56')).toBe(false); // 3 groups: neither format
  });
});

describe('encodeSerial (v2, 80 bits)', () => {
  it('encodes 10 bytes into four groups of Crockford base32', () => {
    const s = encodeSerial(new Uint8Array(10));
    expect(s).toBe('CDFY-0000-0000-0000-0000');
    const ff = encodeSerial(new Uint8Array(10).fill(255));
    expect(ff).toBe('CDFY-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect(SERIAL_PATTERN_V2.test(ff)).toBe(true);
    expect(isValidSerial(ff)).toBe(true);
  });

  it('uses every bit: flipping any input bit changes the serial', () => {
    const base = new Uint8Array(10);
    const seen = new Set([encodeSerial(base)]);
    for (let byte = 0; byte < 10; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const b = new Uint8Array(10);
        b[byte] = 1 << bit;
        seen.add(encodeSerial(b));
      }
    }
    expect(seen.size).toBe(81);
  });

  it('never emits ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = Uint8Array.from(
        { length: 10 },
        (_, j) => (i * 37 + j * 101) & 255,
      );
      expect(encodeSerial(bytes)).not.toMatch(/[ILOU]/);
    }
  });

  it('rejects short input', () => {
    expect(() => encodeSerial(new Uint8Array(8))).toThrow();
  });

  it('legacy serials remain valid; the v2 pattern does not accept them', () => {
    expect(isValidSerial('CDFY-AB12-CD34')).toBe(true);
    expect(LEGACY_SERIAL_PATTERN.test('CDFY-AB12-CD34')).toBe(true);
    expect(SERIAL_PATTERN_V2.test('CDFY-AB12-CD34')).toBe(false);
  });
});

describe('normalizeSerial', () => {
  it('uppercases, trims and fixes O/I typos in the code part', () => {
    expect(normalizeSerial('  cdfy-ab1o-cdi4 ')).toBe('CDFY-AB10-CD14');
    expect(normalizeSerial('nonsense')).toBe('NONSENSE');
  });
});
