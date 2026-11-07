import { Prisma } from '@prisma/client';
import type { NotificationService } from '../notifications/notification.service.js';
import { DailyQuestReminderService } from './daily-quest-reminder.service.js';

// 23:10 UTC = 20:10 São Paulo (default reminder time 20:00 is due).
const EVENING = new Date('2026-10-07T23:10:00Z');
const NOON = new Date('2026-10-07T15:00:00Z'); // 12:00 São Paulo

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  timezone: 'America/Sao_Paulo',
  reminderMinute: null,
  quietHoursStart: null,
  quietHoursEnd: null,
  streak: { lastActivityDate: new Date('2026-10-05T00:00:00Z') },
  ...over,
});

function setup(
  users: ReturnType<typeof user>[],
  events: { userId: string; occurredAt: Date }[] = [],
) {
  const claimed = new Set<string>();
  const prisma = {
    user: {
      findMany: jest.fn(async ({ cursor }: { cursor?: unknown }) =>
        cursor ? [] : users,
      ),
    },
    analyticsEvent: { findMany: jest.fn(async () => events) },
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (claimed.has(data.key))
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        claimed.add(data.key);
        return data;
      }),
    },
  };
  const notifications = {
    notify: jest.fn(async () => ({ push: { status: 'sent' } })),
  };
  const svc = new DailyQuestReminderService(
    prisma as never,
    notifications as unknown as NotificationService,
  );
  return { svc, prisma, notifications, claimed };
}

describe('DailyQuestReminderService', () => {
  it('reminds at 20:00 local by default, once per local day', async () => {
    const { svc, notifications, claimed } = setup([user('a')]);
    expect(await svc.run({ now: NOON })).toMatchObject({
      notDue: 1,
      notified: 0,
    });
    expect(await svc.run({ now: EVENING })).toMatchObject({
      notified: 1,
      pushed: 1,
    });
    expect(
      await svc.run({ now: new Date(EVENING.getTime() + 15 * 60_000) }),
    ).toMatchObject({
      notified: 0,
      alreadyReminded: 1,
    });
    expect([...claimed]).toEqual(['daily_quest_reminder:a:2026-10-07']);
    const build = (notifications.notify.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { kind: string; deepLink: string; title: string };
    expect(build({ locale: 'en-US' })).toMatchObject({
      kind: 'DAILY_QUEST',
      deepLink: '/today',
      title: '🎯 Your daily quests are waiting',
    });
  });

  it('skips users who completed a lesson today (user-local)', async () => {
    const { svc } = setup([
      user('done', {
        streak: { lastActivityDate: new Date('2026-10-07T00:00:00Z') },
      }),
    ]);
    expect(await svc.run({ now: EVENING })).toMatchObject({
      completedToday: 1,
      notified: 0,
    });
  });

  it('uses reminderMinute, then the learned session start + 30 min', async () => {
    const explicit = setup([user('x', { reminderMinute: 12 * 60 })]);
    expect(await explicit.svc.run({ now: NOON })).toMatchObject({
      notified: 1,
    });
    expect(explicit.prisma.analyticsEvent.findMany).not.toHaveBeenCalled();

    // 7 days of first opens at 11:30 local → due 12:00.
    const opens = Array.from({ length: 7 }, (_, d) => ({
      userId: 'l',
      occurredAt: new Date(Date.UTC(2026, 9, 1 + d, 14, 30)),
    }));
    const learned = setup([user('l')], opens);
    expect(await learned.svc.run({ now: NOON })).toMatchObject({ notified: 1 });
    expect(
      await setup([user('l')], opens.slice(0, 6)).svc.run({ now: NOON }),
    ).toMatchObject({
      notDue: 1,
    });
  });

  it('never reminds inside quiet hours', async () => {
    const { svc } = setup([
      user('q', { quietHoursStart: 19 * 60, quietHoursEnd: 7 * 60 }),
    ]);
    expect(await svc.run({ now: EVENING })).toMatchObject({
      quietHours: 1,
      notified: 0,
    });
  });
});
