import { Prisma } from '@prisma/client';
import type { NotificationService } from './notification.service.js';
import { StreakReminderService } from './streak-reminder.service.js';

interface StreakRow {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  lastActivityDate: Date;
  user: {
    id: string;
    timezone: string;
    locale: string;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
    deviceTokens: { token: string }[];
  };
}

function streak(
  id: string,
  lastLocalDate: string,
  over: Partial<StreakRow['user']> = {},
  days = 5,
  freezes = 0,
): StreakRow {
  return {
    currentDays: days,
    longestDays: days,
    freezesAvailable: freezes,
    // Stored as the user-local date at UTC midnight (GamificationService).
    lastActivityDate: new Date(`${lastLocalDate}T00:00:00Z`),
    user: {
      id,
      timezone: 'America/Sao_Paulo',
      locale: 'pt-BR',
      quietHoursStart: null,
      quietHoursEnd: null,
      deviceTokens: [{ token: `tok-${id}` }],
      ...over,
    },
  };
}

function setup(rows: StreakRow[]) {
  const claimed = new Set<string>();
  const prisma = {
    streak: { findMany: jest.fn().mockResolvedValue(rows) },
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (claimed.has(data.key)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        }
        claimed.add(data.key);
        return data;
      }),
    },
  };
  const notifications = {
    notify: jest.fn(
      async (): Promise<{ push: Record<string, unknown> }> => ({
        push: { status: 'sent', sent: 1, failed: 0, pruned: 0 },
      }),
    ),
  };
  return {
    prisma,
    notifications,
    claimed,
    svc: new StreakReminderService(
      prisma as never,
      notifications as unknown as NotificationService,
    ),
  };
}

// 23:30 UTC on Oct 7 = 20:30 in São Paulo → inside the evening slot.
const EVENING = new Date('2026-10-07T23:30:00Z');
// 15:00 UTC = 12:00 São Paulo → outside the slot.
const NOON = new Date('2026-10-07T15:00:00Z');

describe('StreakReminderService', () => {
  it('manual mode reminds every at-risk user regardless of the time', async () => {
    const { svc, notifications } = setup([
      streak('risk', '2026-10-06'),
      streak('ok', '2026-10-07'),
    ]);
    const res = await svc.run({ mode: 'manual', now: NOON });
    expect(res).toEqual({ candidates: 1, pushed: 1, pruned: 0, capped: 0 });
    const [userId, build, opts] = notifications.notify.mock
      .calls[0] as unknown as [
      string,
      (u: { locale: string }) => {
        kind: string;
        body: string;
        data: Record<string, string>;
      },
      { respectQuietHours: boolean },
    ];
    expect(userId).toBe('risk');
    expect(opts.respectQuietHours).toBe(false);
    const msg = build({ locale: 'pt-BR' });
    expect(msg).toMatchObject({
      kind: 'STREAK_REMINDER',
      data: { type: 'streak_reminder', streakDays: '5' },
    });
    expect(msg.body).toMatch(/dias seguidos/);
    expect(build({ locale: 'en-US' }).body).toMatch(/5-day streak/);
  });

  it('treats a streak advanced today (UTC-midnight date) as safe in a UTC-3 zone', async () => {
    // Regression: converting 2026-10-07T00:00Z to São Paulo gives Oct 6.
    const { svc } = setup([streak('acted-today', '2026-10-07')]);
    expect((await svc.run({ mode: 'manual', now: EVENING })).candidates).toBe(
      0,
    );
  });

  it('scheduled mode only reaches users in their local evening slot', async () => {
    const tokyo = streak('tokyo', '2026-10-06', {
      timezone: 'Asia/Tokyo',
      locale: 'en',
    }); // 08:30 local
    const { svc } = setup([streak('sp', '2026-10-06'), tokyo]);
    const res = await svc.run({ mode: 'scheduled', now: EVENING });
    expect(res).toMatchObject({ candidates: 1, pushed: 1 });
    expect(
      (
        await setup([streak('sp', '2026-10-06')]).svc.run({
          mode: 'scheduled',
          now: NOON,
        })
      ).candidates,
    ).toBe(0);
  });

  it('scheduled mode skips users whose quiet hours cover the slot', async () => {
    const { svc } = setup([
      streak('early-sleeper', '2026-10-06', {
        quietHoursStart: 20 * 60,
        quietHoursEnd: 7 * 60,
      }),
    ]);
    const res = await svc.run({ mode: 'scheduled', now: EVENING });
    expect(res).toMatchObject({ candidates: 0, skippedQuietHours: 1 });
  });

  it('scheduled mode is idempotent per user per local day', async () => {
    const { svc, prisma, claimed } = setup([streak('sp', '2026-10-06')]);
    await svc.run({ mode: 'scheduled', now: EVENING });
    const second = await svc.run({
      mode: 'scheduled',
      now: new Date('2026-10-08T00:30:00Z'),
    }); // 21:30 local
    expect(second).toMatchObject({ candidates: 0, alreadyReminded: 1 });
    expect([...claimed]).toEqual(['streak_reminder:sp:2026-10-07']);
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledTimes(2);
  });

  it('counts users whose push was capped (the inbox row is still written)', async () => {
    const { svc, notifications } = setup([streak('sp', '2026-10-06')]);
    notifications.notify.mockResolvedValueOnce({
      push: { status: 'capped', reason: 'daily' },
    });
    const res = await svc.run({ mode: 'scheduled', now: EVENING });
    expect(res).toMatchObject({ candidates: 1, capped: 1, pushed: 0 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('skips streaks that are already lost (FIX-7), keeps ones freezes cover', async () => {
    // Now = Oct 7 in São Paulo. Last activity Oct 5 → Oct 6 was missed.
    const { svc, notifications } = setup([
      streak('lost', '2026-10-05', {}, 12, 0),
      streak('frozen', '2026-10-05', {}, 12, 1),
    ]);
    const res = await svc.run({ mode: 'manual', now: NOON });
    expect(res.candidates).toBe(1);
    expect(
      (notifications.notify.mock.calls as unknown as [string][]).map(
        (c) => c[0],
      ),
    ).toEqual(['frozen']);
  });

  it('time zones: the same instant is "yesterday" in one zone and a missed day in another', async () => {
    // 2026-10-07T01:00Z: São Paulo is still Oct 6 (last Oct 5 = yesterday,
    // live), Tokyo is Oct 7 (Oct 6 missed, lost).
    const at = new Date('2026-10-07T01:00:00Z');
    const { svc, notifications } = setup([
      streak('sp', '2026-10-05'),
      streak('tokyo', '2026-10-05', { timezone: 'Asia/Tokyo' }),
    ]);
    await svc.run({ mode: 'manual', now: at });
    expect(
      (notifications.notify.mock.calls as unknown as [string][]).map(
        (c) => c[0],
      ),
    ).toEqual(['sp']);
  });

  it('only queries users who did not turn STREAK_REMINDER push off', async () => {
    const { svc, prisma } = setup([]);
    await svc.run({ mode: 'manual', now: NOON });
    const where = (
      prisma.streak.findMany.mock.calls[0] as unknown as [
        { where: { user: Record<string, unknown> } },
      ]
    )[0].where.user;
    expect(where['notificationPrefs']).toEqual({
      none: { kind: 'STREAK_REMINDER', pushEnabled: false },
    });
    expect(where['dormantAt']).toBeNull();
  });
});
