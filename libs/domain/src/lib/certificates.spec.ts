import { formatSerial, isCourseComplete, isValidSerial } from './certificates.js';

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
  });
});
