import {
  calendarDays,
  matchesWindow,
  onDay,
  shiftAnchor,
  startOfWeek,
} from './promo-calendar';

const d = (s: string) => new Date(s);

describe('promo calendar', () => {
  it('lays out Monday-first weeks and months', () => {
    expect(startOfWeek(d('2026-11-08T12:00:00')).getDay()).toBe(1);
    const week = calendarDays(d('2026-11-08T12:00:00'), 'week');
    expect(week).toHaveLength(7);
    expect(week[0].getDate()).toBe(2); // Mon 2 Nov 2026
    const month = calendarDays(d('2026-11-15T12:00:00'), 'month');
    expect(month.length % 7).toBe(0);
    expect(month[0].getDay()).toBe(1);
    expect(month.some((x) => x.getMonth() === 10 && x.getDate() === 30)).toBe(
      true,
    );
    expect(shiftAnchor(d('2026-11-15T00:00:00'), 'month', 1).getMonth()).toBe(
      11,
    );
  });

  it('places windows on the days they overlap', () => {
    const rows = [
      {
        id: 'a',
        startsAt: '2026-11-03T10:00:00',
        endsAt: '2026-11-04T10:00:00',
      },
      { id: 'b', startsAt: null, endsAt: null },
    ];
    expect(onDay(rows, d('2026-11-03T00:00:00')).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
    expect(onDay(rows, d('2026-11-05T00:00:00')).map((r) => r.id)).toEqual([
      'b',
    ]);
  });

  it('filters by time window', () => {
    const now = d('2026-11-08T12:00:00');
    const past = {
      startsAt: '2026-11-01T00:00:00',
      endsAt: '2026-11-02T00:00:00',
    };
    const live = { startsAt: '2026-11-07T00:00:00', endsAt: null };
    const next = {
      startsAt: '2026-11-20T00:00:00',
      endsAt: '2026-11-21T00:00:00',
    };
    expect(matchesWindow(past, 'ended', now)).toBe(true);
    expect(matchesWindow(live, 'active', now)).toBe(true);
    expect(matchesWindow({ ...live, isActive: false }, 'active', now)).toBe(
      false,
    );
    expect(matchesWindow(next, 'upcoming', now)).toBe(true);
    expect(
      matchesWindow(next, 'range', now, {
        from: d('2026-11-19T00:00:00'),
        to: d('2026-11-22T00:00:00'),
      }),
    ).toBe(true);
    expect(
      matchesWindow(past, 'range', now, {
        from: d('2026-11-19T00:00:00'),
        to: null,
      }),
    ).toBe(false);
  });
});
