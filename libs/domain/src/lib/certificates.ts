/**
 * Pure helpers for certificates of completion (Phase 13). Serial *generation*
 * needs randomness (it lives in the API); this module owns the deterministic,
 * testable parts: the completion rule and serial formatting/validation.
 */

/** A course is complete when every (non-deleted) lesson has been finished. */
export function isCourseComplete(totalLessons: number, completedLessons: number): boolean {
  return totalLessons > 0 && completedLessons >= totalLessons;
}

/** Public serial format: CDFY-XXXX-XXXX (Crockford-ish base32, no ambiguous chars). */
export const SERIAL_PATTERN = /^CDFY-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/;

export function isValidSerial(serial: string): boolean {
  return SERIAL_PATTERN.test(serial);
}

/** Format raw entropy (hex/base32 chars) into a CDFY-XXXX-XXXX serial. */
export function formatSerial(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^0-9A-HJ-NP-Z]/g, '') // drop I, O, L and separators
    .padEnd(8, '0')
    .slice(0, 8);
  return `CDFY-${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}
