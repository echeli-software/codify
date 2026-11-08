import {
  addDays,
  advanceStreak,
  dayDiff,
  effectiveStreak,
  localDateKey,
  localDayStart,
  settleStreak,
  type StreakState,
} from './streaks.js';

const s = (over: Partial<StreakState> = {}): StreakState => ({
  currentDays: 5,
  longestDays: 9,
  freezesAvailable: 0,
  lastActivityKey: '2026-11-05',
  ...over,
});

describe('date keys', () => {
  it('localDateKey follows the user zone, not UTC', () => {
    // 02:30 UTC on Nov 6 is still Nov 5 in São Paulo (UTC−3) …
    const at = new Date('2026-11-06T02:30:00Z');
    expect(localDateKey(at, 'America/Sao_Paulo')).toBe('2026-11-05');
    // … and already Nov 6 in Tokyo / UTC.
    expect(localDateKey(at, 'Asia/Tokyo')).toBe('2026-11-06');
    expect(localDateKey(at, 'UTC')).toBe('2026-11-06');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(localDateKey(new Date('2026-11-06T02:30:00Z'), 'Not/AZone')).toBe(
      '2026-11-06',
    );
  });

  it('dayDiff / addDays are calendar arithmetic (DST-safe)', () => {
    expect(dayDiff('2026-11-07', '2026-11-05')).toBe(2);
    expect(dayDiff('2026-03-09', '2026-03-08')).toBe(1); // US DST start
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('settleStreak', () => {
  it('today and yesterday are not missed', () => {
    expect(settleStreak(s(), '2026-11-05').changed).toBe(false);
    expect(settleStreak(s(), '2026-11-06')).toMatchObject({
      currentDays: 5,
      changed: false,
      missedDays: 0,
    });
  });

  it('a missed day with no freeze loses the streak (keeps longest)', () => {
    expect(settleStreak(s(), '2026-11-07')).toMatchObject({
      currentDays: 0,
      longestDays: 9,
      lost: true,
      missedDays: 1,
      changed: true,
      lastActivityKey: '2026-11-06',
    });
  });

  it('freezes cover missed days one each and move the covered day', () => {
    expect(
      settleStreak(s({ freezesAvailable: 2 }), '2026-11-08'),
    ).toMatchObject({
      currentDays: 5,
      freezesAvailable: 0,
      freezesUsed: 2,
      lost: false,
      lastActivityKey: '2026-11-07',
    });
    // Settling again the same day is a no-op (idempotent job).
    const once = settleStreak(s({ freezesAvailable: 2 }), '2026-11-07');
    expect(once.freezesUsed).toBe(1);
    expect(settleStreak(once, '2026-11-07').changed).toBe(false);
  });

  it('more missed days than freezes: freezes are used up, then lost', () => {
    expect(
      settleStreak(s({ freezesAvailable: 1 }), '2026-11-08'),
    ).toMatchObject({
      currentDays: 0,
      freezesAvailable: 0,
      freezesUsed: 1,
      lost: true,
    });
  });

  it('a zero streak has nothing to protect', () => {
    const z = s({ currentDays: 0, freezesAvailable: 2 });
    expect(settleStreak(z, '2026-11-20')).toMatchObject({
      changed: false,
      freezesAvailable: 2,
    });
  });
});

describe('advanceStreak', () => {
  it('first activity starts at 1', () => {
    expect(advanceStreak(null, '2026-11-05', 2)).toMatchObject({
      currentDays: 1,
      extended: true,
    });
  });

  it('same day is already counted; next day adds one', () => {
    expect(advanceStreak(s(), '2026-11-05', 2)).toMatchObject({
      currentDays: 5,
      extended: false,
      changed: false,
    });
    expect(advanceStreak(s(), '2026-11-06', 2)).toMatchObject({
      currentDays: 6,
      extended: true,
      lastActivityKey: '2026-11-06',
    });
  });

  it('an older (offline) event never rewinds the streak', () => {
    expect(advanceStreak(s(), '2026-11-03', 2).changed).toBe(false);
  });

  it('a gap covered by a freeze keeps the streak going', () => {
    expect(
      advanceStreak(s({ freezesAvailable: 1 }), '2026-11-07', 2),
    ).toMatchObject({ currentDays: 6, freezesAvailable: 0, freezesUsed: 1 });
  });

  it('after a loss the streak restarts at 1 and says so', () => {
    expect(advanceStreak(s(), '2026-11-08', 2)).toMatchObject({
      currentDays: 1,
      longestDays: 9,
      lost: true,
      restartedAfterLoss: true,
    });
    // A row the nightly job already reset to 0 restarts the same way.
    expect(
      advanceStreak(
        s({ currentDays: 0, lastActivityKey: '2026-11-07' }),
        '2026-11-08',
        2,
      ),
    ).toMatchObject({ currentDays: 1, restartedAfterLoss: true });
  });

  it('earns a freeze every 7th day, capped', () => {
    expect(advanceStreak(s({ currentDays: 6 }), '2026-11-06', 2)).toMatchObject(
      { currentDays: 7, freezesAvailable: 1, freezeEarned: true },
    );
    expect(
      advanceStreak(
        s({ currentDays: 13, freezesAvailable: 2 }),
        '2026-11-06',
        2,
      ),
    ).toMatchObject({
      currentDays: 14,
      freezesAvailable: 2,
      freezeEarned: false,
    });
  });
});

describe('effectiveStreak', () => {
  it('shows a stale row as lost', () => {
    expect(effectiveStreak(s(), '2026-11-07')).toEqual({
      currentDays: 0,
      longestDays: 9,
      freezesAvailable: 0,
      activeToday: false,
    });
  });

  it('shows a live row as is, and whether today is done', () => {
    expect(effectiveStreak(s(), '2026-11-06').currentDays).toBe(5);
    expect(effectiveStreak(s(), '2026-11-05').activeToday).toBe(true);
    expect(effectiveStreak(null, '2026-11-05').currentDays).toBe(0);
  });

  it('time zones: the same instant can be live in one zone and lost in another', () => {
    // Last activity Nov 5 (local). At 2026-11-07T01:00Z it is still Nov 6
    // in São Paulo (live — yesterday was Nov 5) but already Nov 7 in UTC.
    const at = new Date('2026-11-07T01:00:00Z');
    expect(
      effectiveStreak(s(), localDateKey(at, 'America/Sao_Paulo')).currentDays,
    ).toBe(5);
    expect(effectiveStreak(s(), localDateKey(at, 'UTC')).currentDays).toBe(0);
  });
});

describe('localDayStart', () => {
  it('is local midnight as an instant', () => {
    const at = new Date('2026-11-06T02:30:15.250Z');
    // São Paulo (UTC−3): local Nov 5 23:30 → started Nov 5 03:00Z.
    expect(localDayStart(at, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-05T03:00:00.000Z',
    );
    expect(localDayStart(at, 'UTC').toISOString()).toBe(
      '2026-11-06T00:00:00.000Z',
    );
    expect(localDayStart(at, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-05T18:30:00.000Z',
    );
  });
});
