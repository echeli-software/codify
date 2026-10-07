/**
 * Pure helpers for certificates of completion (Phase 13). Serial *generation*
 * needs randomness (the API supplies CSPRNG bytes); this module owns the
 * deterministic, testable parts: the completion rule and serial
 * encoding/validation.
 */

/** A course is complete when every (non-deleted) lesson has been finished. */
export function isCourseComplete(
  totalLessons: number,
  completedLessons: number,
): boolean {
  return totalLessons > 0 && completedLessons >= totalLessons;
}

/** Characters allowed in a serial group (ambiguous I and O never appear). */
const SERIAL_CHAR = '[0-9A-HJ-NP-Z]';

/**
 * Legacy serial format: CDFY-XXXX-XXXX (8 chars, ≤ 40 bits). Still verified so
 * certificates issued before the entropy bump keep working.
 */
export const LEGACY_SERIAL_PATTERN = new RegExp(
  `^CDFY-${SERIAL_CHAR}{4}-${SERIAL_CHAR}{4}$`,
);

/**
 * Current serial format: CDFY-XXXX-XXXX-XXXX-XXXX — 16 Crockford base32
 * characters = 80 bits of entropy (≥ 64 bits, so serials are unguessable),
 * still grouped in fours for reading aloud / typing.
 */
export const SERIAL_PATTERN_V2 = new RegExp(`^CDFY(?:-${SERIAL_CHAR}{4}){4}$`);

/** Any serial we have ever issued (legacy or current). */
export const SERIAL_PATTERN = new RegExp(
  `^CDFY-${SERIAL_CHAR}{4}-${SERIAL_CHAR}{4}(?:-${SERIAL_CHAR}{4}-${SERIAL_CHAR}{4})?$`,
);

export function isValidSerial(serial: string): boolean {
  return SERIAL_PATTERN.test(serial);
}

/** Crockford base32 alphabet (no I, L, O, U) — every char matches SERIAL_CHAR. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Bytes of entropy a v2 serial consumes (16 chars × 5 bits = 80 bits). */
export const SERIAL_ENTROPY_BYTES = 10;

/**
 * Encode ≥ {@link SERIAL_ENTROPY_BYTES} random bytes as a v2 serial
 * (CDFY-XXXX-XXXX-XXXX-XXXX). Uses exactly the first 80 bits.
 */
export function encodeSerial(bytes: Uint8Array): string {
  if (bytes.length < SERIAL_ENTROPY_BYTES) {
    throw new Error(
      `encodeSerial needs at least ${SERIAL_ENTROPY_BYTES} bytes`,
    );
  }
  let chars = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < SERIAL_ENTROPY_BYTES; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      chars += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return `CDFY-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/**
 * Normalize user-typed input for lookup: trim, uppercase, and map the
 * look-alikes people type by mistake (O→0, I/L→1 per Crockford) in the
 * code part only. Returns the input unchanged (uppercased) if it doesn't
 * look like a serial at all.
 */
export function normalizeSerial(input: string): string {
  const s = input.trim().toUpperCase();
  if (!s.startsWith('CDFY-')) return s;
  return 'CDFY-' + s.slice(5).replace(/O/g, '0').replace(/I/g, '1');
}

/**
 * Format raw entropy (hex/base32 chars) into a legacy CDFY-XXXX-XXXX serial.
 * @deprecated Only ~32–40 bits of entropy; new serials use {@link encodeSerial}.
 */
export function formatSerial(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^0-9A-HJ-NP-Z]/g, '') // drop I, O and separators
    .padEnd(8, '0')
    .slice(0, 8);
  return `CDFY-${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}
