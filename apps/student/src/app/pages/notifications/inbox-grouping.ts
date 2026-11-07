import type { InboxNotification } from '@codify/api-client';

export interface InboxDayGroup {
  /** Local calendar day, 'YYYY-MM-DD'. */
  day: string;
  /** How to label it: Today / Yesterday, or the formatted `date`. */
  label: 'today' | 'yesterday' | 'date';
  /** Noon of that local day (for date formatting in the current locale). */
  date: Date;
  items: InboxNotification[];
}

/** 'YYYY-MM-DD' of an instant in the device's local time. */
export function localDay(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Group inbox entries by local calendar day (docs/05 "group by day"),
 * newest day first and newest entry first inside a day. The label is
 * resolved against `now` so "Today"/"Yesterday" follow the device clock
 * across midnight.
 */
export function groupByDay(
  items: readonly InboxNotification[],
  now: Date = new Date(),
): InboxDayGroup[] {
  const today = localDay(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = localDay(y);
  const groups: InboxDayGroup[] = [];
  const sorted = [...items].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const item of sorted) {
    const at = new Date(item.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const day = localDay(at);
    let group = groups.find((g) => g.day === day);
    if (!group) {
      const date = new Date(at);
      date.setHours(12, 0, 0, 0);
      group = {
        day,
        label:
          day === today ? 'today' : day === yesterday ? 'yesterday' : 'date',
        date,
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Merge a fetched page into the list: dedupe by id, newest first. */
export function mergeInbox(
  current: readonly InboxNotification[],
  incoming: readonly InboxNotification[],
): InboxNotification[] {
  const byId = new Map<string, InboxNotification>();
  for (const n of current) byId.set(n.id, n);
  for (const n of incoming) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? b.id.localeCompare(a.id)
      : b.createdAt.localeCompare(a.createdAt),
  );
}
