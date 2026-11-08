import {
  ADULT_AGE,
  MAX_AGE,
  MINIMUM_AGE,
  addYears,
  adultBirthDateCutoff,
  ageGroup,
  ageOn,
  birthDateKey,
  canReceiveMarketing,
  checkBirthDate,
  classifyAge,
  isDateKey,
  isKnownAdult,
  isMinor,
  localDay,
  parseDateKey,
} from './age.js';

describe('age rules', () => {
  it('has the launch thresholds', () => {
    expect([MINIMUM_AGE, ADULT_AGE, MAX_AGE]).toEqual([12, 18, 120]);
  });

  describe('parseDateKey / isDateKey', () => {
    it('accepts real calendar dates', () => {
      expect(parseDateKey('2010-05-31')).toEqual({ y: 2010, m: 5, d: 31 });
      expect(isDateKey('2024-02-29')).toBe(true); // leap (÷4)
      expect(isDateKey('2000-02-29')).toBe(true); // leap (÷400)
    });

    it('refuses impossible or malformed dates', () => {
      for (const bad of [
        '1900-02-29', // ÷100, not a leap year
        '2023-02-29',
        '2023-04-31',
        '2023-13-01',
        '2023-00-10',
        '2023-01-00',
        '0000-01-01',
        '2023-1-01',
        '2023/01/01',
        '2023-01-01T00:00:00Z',
        '',
      ])
        expect(isDateKey(bad)).toBe(false);
      expect(parseDateKey(20230101)).toBeNull();
      expect(parseDateKey(null)).toBeNull();
    });
  });

  describe('ageOn', () => {
    it('counts whole years, birthday inclusive', () => {
      expect(ageOn('2014-11-08', '2026-11-08')).toBe(12);
      expect(ageOn('2014-11-09', '2026-11-08')).toBe(11);
      expect(ageOn('2014-12-01', '2026-11-30')).toBe(11);
      expect(ageOn('2008-01-01', '2026-11-08')).toBe(18);
      expect(ageOn('2026-11-08', '2026-11-08')).toBe(0);
    });

    it('ages 29 February birthdays on 1 March in common years', () => {
      expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
      expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
      expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
    });

    it('throws on malformed input', () => {
      expect(() => ageOn('nope', '2026-11-08')).toThrow(RangeError);
      expect(() => ageOn('2010-01-01', 'nope')).toThrow(RangeError);
    });
  });

  describe('addYears', () => {
    it('shifts years and clamps to the month end', () => {
      expect(addYears('2026-11-08', -18)).toBe('2008-11-08');
      expect(addYears('2028-02-29', -18)).toBe('2010-02-28');
      expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
      expect(addYears('0100-01-01', -99)).toBe('0001-01-01');
    });

    it('throws on malformed input', () => {
      expect(() => addYears('x', 1)).toThrow(RangeError);
    });
  });

  describe('checkBirthDate', () => {
    const today = '2026-11-08';
    it('accepts today and anything up to MAX_AGE years ago', () => {
      expect(checkBirthDate('2010-06-15', today)).toBeNull();
      expect(checkBirthDate(today, today)).toBeNull();
      expect(checkBirthDate('1906-11-08', today)).toBeNull(); // exactly 120
    });

    it('names the problem', () => {
      expect(checkBirthDate('2010-02-30', today)).toBe('invalid');
      expect(checkBirthDate(undefined, today)).toBe('invalid');
      expect(checkBirthDate('2026-11-09', today)).toBe('future');
      expect(checkBirthDate('1906-11-07', today)).toBeNull(); // 120 and a day
      expect(checkBirthDate('1905-11-08', today)).toBe('too_old'); // 121
      expect(checkBirthDate('1800-01-01', today)).toBe('too_old');
    });
  });

  describe('classifyAge', () => {
    const today = '2026-11-08';
    it('splits under 12 / 12–17 / 18+', () => {
      expect(classifyAge('2014-11-09', today)).toBe('under_minimum'); // 11
      expect(classifyAge('2014-11-08', today)).toBe('minor'); // 12 today
      expect(classifyAge('2008-11-09', today)).toBe('minor'); // 17
      expect(classifyAge('2008-11-08', today)).toBe('adult'); // 18 today
    });
  });

  describe('localDay', () => {
    const at = new Date('2026-11-08T01:30:00Z');
    it('uses the given time zone', () => {
      expect(localDay(at, 'UTC')).toBe('2026-11-08');
      expect(localDay(at, 'America/Sao_Paulo')).toBe('2026-11-07');
      expect(localDay(at, 'Asia/Tokyo')).toBe('2026-11-08');
    });

    it('falls back to UTC for a missing or unknown zone', () => {
      expect(localDay(at, null)).toBe('2026-11-08');
      expect(localDay(at, undefined)).toBe('2026-11-08');
      expect(localDay(at, 'Not/AZone')).toBe('2026-11-08');
    });
  });

  describe('birthDateKey', () => {
    it('normalises stored values', () => {
      expect(birthDateKey(null)).toBeNull();
      expect(birthDateKey(undefined)).toBeNull();
      expect(birthDateKey(new Date('2010-05-31T00:00:00Z'))).toBe('2010-05-31');
      expect(birthDateKey(new Date('invalid'))).toBeNull();
      expect(birthDateKey('2010-05-31')).toBe('2010-05-31');
      expect(birthDateKey('2010-05-31T00:00:00.000Z')).toBe('2010-05-31');
      expect(birthDateKey('31/05/2010')).toBeNull();
    });
  });

  describe('ageGroup and friends', () => {
    // 8 Nov 2026, 01:30 UTC = 7 Nov 22:30 in São Paulo.
    const now = new Date('2026-11-08T01:30:00Z');

    it('is null without a date of birth (fail closed everywhere)', () => {
      const u = { birthDate: null };
      expect(ageGroup(u, now)).toBeNull();
      expect(isMinor(u, now)).toBe(false);
      expect(isKnownAdult(u, now)).toBe(false);
      expect(canReceiveMarketing(u, now)).toBe(false);
    });

    it('counts the birthday on the user’s own calendar day', () => {
      const born = new Date('2008-11-08T00:00:00Z');
      expect(ageGroup({ birthDate: born, timezone: 'UTC' }, now)).toBe('adult');
      // Still the 7th in São Paulo: 17 for a few more hours.
      const sp = { birthDate: born, timezone: 'America/Sao_Paulo' };
      expect(ageGroup(sp, now)).toBe('minor');
      expect(isMinor(sp, now)).toBe(true);
      expect(isKnownAdult(sp, now)).toBe(false);
      expect(canReceiveMarketing(sp, now)).toBe(false);
    });

    it('lets adults receive marketing', () => {
      const u = { birthDate: '1990-01-01', timezone: 'UTC' };
      expect(isKnownAdult(u, now)).toBe(true);
      expect(isMinor(u, now)).toBe(false);
      expect(canReceiveMarketing(u, now)).toBe(true);
    });

    it('reads a stored under-12 date as minor, and uses the clock by default', () => {
      expect(ageGroup({ birthDate: '2020-01-01' }, now)).toBe('minor');
      expect(ageGroup({ birthDate: '1990-01-01' })).toBe('adult');
      expect(isMinor({ birthDate: '1990-01-01' })).toBe(false);
      expect(isKnownAdult({ birthDate: '1990-01-01' })).toBe(true);
      expect(canReceiveMarketing({ birthDate: '1990-01-01' })).toBe(true);
    });
  });

  describe('adultBirthDateCutoff', () => {
    it('uses the earliest local day on Earth (UTC−12)', () => {
      // 8 Nov 2026 10:00 UTC is still 7 Nov in UTC−12.
      expect(adultBirthDateCutoff(new Date('2026-11-08T10:00:00Z'))).toBe(
        '2008-11-07',
      );
      expect(adultBirthDateCutoff(new Date('2026-11-08T12:00:00Z'))).toBe(
        '2008-11-08',
      );
      expect(typeof adultBirthDateCutoff()).toBe('string');
    });
  });
});
