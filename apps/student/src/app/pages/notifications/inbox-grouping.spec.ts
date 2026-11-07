import type { InboxNotification } from '@codify/api-client';
import { groupByDay, localDay, mergeInbox } from './inbox-grouping';

const n = (
  id: string,
  createdAt: Date | string,
  readAt: string | null = null,
): InboxNotification => ({
  id,
  kind: 'FRIEND_NUDGE',
  title: id,
  body: 'b',
  deepLink: '/friends',
  action: null,
  createdAt:
    typeof createdAt === 'string' ? createdAt : createdAt.toISOString(),
  readAt,
});

/** A local (device-time) instant. */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe('groupByDay', () => {
  const now = at(2026, 11, 7, 10);

  it('groups newest-first entries by local day, labelling today / yesterday', () => {
    const groups = groupByDay(
      [
        n('a', at(2026, 11, 7, 9)),
        n('b', at(2026, 11, 7, 0, 5)),
        n('c', at(2026, 11, 6, 23, 59)),
        n('d', at(2026, 11, 2, 12)),
      ],
      now,
    );
    expect(
      groups.map((g) => [g.day, g.label, g.items.map((i) => i.id)]),
    ).toEqual([
      ['2026-11-07', 'today', ['a', 'b']],
      ['2026-11-06', 'yesterday', ['c']],
      ['2026-11-02', 'date', ['d']],
    ]);
    expect(groups[2].date.getHours()).toBe(12);
    expect(localDay(groups[2].date)).toBe('2026-11-02');
  });

  it('follows the device clock across midnight and month boundaries', () => {
    const groups = groupByDay(
      [n('x', at(2026, 10, 31, 22))],
      at(2026, 11, 1, 0, 30),
    );
    expect(groups[0]).toMatchObject({ day: '2026-10-31', label: 'yesterday' });
  });

  it('orders days and entries newest first whatever the input order', () => {
    const groups = groupByDay(
      [
        n('old', at(2026, 11, 2, 12)),
        n('today-early', at(2026, 11, 7, 1)),
        n('y', at(2026, 11, 6, 8)),
        n('today-late', at(2026, 11, 7, 9)),
      ],
      now,
    );
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ['today-late', 'today-early'],
      ['y'],
      ['old'],
    ]);
  });

  it('skips entries with an invalid date and handles an empty inbox', () => {
    expect(groupByDay([n('bad', 'not-a-date')], now)).toEqual([]);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('mergeInbox', () => {
  it('dedupes by id (incoming wins) and keeps newest first', () => {
    const merged = mergeInbox(
      [n('b', '2026-11-07T10:00:00Z'), n('a', '2026-11-06T10:00:00Z')],
      [
        n('a', '2026-11-06T10:00:00Z', '2026-11-07T11:00:00Z'),
        n('z', '2026-11-01T00:00:00Z'),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(['b', 'a', 'z']);
    expect(merged[1].readAt).toBe('2026-11-07T11:00:00Z');
  });
});
