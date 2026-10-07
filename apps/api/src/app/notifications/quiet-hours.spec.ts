import {
  isWithinQuietHours,
  localClock,
  minutesUntilQuietEnds,
  quietWindow,
} from './quiet-hours.js';

describe('quiet hours', () => {
  it('computes the user-local date and minute of day', () => {
    // 2026-10-07T23:30Z = 20:30 in São Paulo (UTC-3), 08:30 next day in Tokyo.
    const at = new Date('2026-10-07T23:30:00Z');
    expect(localClock(at, 'America/Sao_Paulo')).toEqual({
      date: '2026-10-07',
      minutes: 20 * 60 + 30,
    });
    expect(localClock(at, 'Asia/Tokyo')).toEqual({
      date: '2026-10-08',
      minutes: 8 * 60 + 30,
    });
  });

  it('falls back to São Paulo for unknown zones', () => {
    const at = new Date('2026-10-07T12:00:00Z');
    expect(localClock(at, 'Not/AZone')).toEqual(
      localClock(at, 'America/Sao_Paulo'),
    );
    expect(localClock(at, null)).toEqual(localClock(at, 'America/Sao_Paulo'));
  });

  it('defaults to 22:00–08:00', () => {
    expect(quietWindow(null, undefined)).toEqual({ start: 1320, end: 480 });
    expect(quietWindow(60, 120)).toEqual({ start: 60, end: 120 });
  });

  it('handles windows that wrap midnight', () => {
    expect(isWithinQuietHours(23 * 60, 1320, 480)).toBe(true);
    expect(isWithinQuietHours(3 * 60, 1320, 480)).toBe(true);
    expect(isWithinQuietHours(8 * 60, 1320, 480)).toBe(false);
    expect(isWithinQuietHours(21 * 60 + 59, 1320, 480)).toBe(false);
  });

  it('handles same-day windows and the empty window', () => {
    expect(isWithinQuietHours(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(isWithinQuietHours(14 * 60, 12 * 60, 14 * 60)).toBe(false);
    expect(isWithinQuietHours(100, 300, 300)).toBe(false);
  });

  it('computes minutes until the window ends', () => {
    expect(minutesUntilQuietEnds(23 * 60, 1320, 480)).toBe(9 * 60);
    expect(minutesUntilQuietEnds(7 * 60 + 30, 1320, 480)).toBe(30);
    expect(minutesUntilQuietEnds(12 * 60, 1320, 480)).toBe(0);
  });
});
