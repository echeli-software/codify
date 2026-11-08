import { Prisma } from '@prisma/client';
import type { NotificationService } from '../notifications/notification.service.js';
import { WeeklyRecapService, isRecapTime } from './weekly-recap.service.js';

// Monday 2026-10-12 13:00Z = 10:00 São Paulo.
const MONDAY_10 = new Date('2026-10-12T13:00:00Z');

function setup(xp: number, lessons: number) {
  const claimed = new Set<string>();
  const prisma = {
    user: {
      findMany: jest.fn(
        async (args: { distinct?: unknown; cursor?: unknown }) => {
          if (args.distinct)
            return [
              { timezone: 'America/Sao_Paulo' },
              { timezone: 'Asia/Tokyo' },
            ];
          if (args.cursor) return [];
          return [
            {
              id: 'u1',
              timezone: 'America/Sao_Paulo',
              // Active yesterday (local Sunday) → still a live 4-day streak.
              streak: {
                currentDays: 4,
                longestDays: 4,
                freezesAvailable: 0,
                lastActivityDate: new Date('2026-10-11T00:00:00Z'),
              },
            },
          ];
        },
      ),
    },
    xpEvent: {
      groupBy: jest.fn(async () =>
        xp ? [{ userId: 'u1', _sum: { amount: xp } }] : [],
      ),
    },
    progress: {
      groupBy: jest.fn(async () =>
        lessons ? [{ userId: 'u1', _count: { _all: lessons } }] : [],
      ),
    },
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
    notify: jest.fn(async () => ({ email: { status: 'sent' } })),
  };
  const svc = new WeeklyRecapService(
    prisma as never,
    notifications as unknown as NotificationService,
  );
  return { svc, prisma, notifications, claimed };
}

describe('isRecapTime', () => {
  it('is Monday 09:00–12:00 user-local', () => {
    expect(isRecapTime(MONDAY_10, 'America/Sao_Paulo')).toBe(true);
    expect(isRecapTime(MONDAY_10, 'Asia/Tokyo')).toBe(false); // Monday 22:00
    expect(
      isRecapTime(new Date('2026-10-13T13:00:00Z'), 'America/Sao_Paulo'),
    ).toBe(false);
  });
});

describe('WeeklyRecapService', () => {
  it("emails last week's stats once per ISO week, only in due zones", async () => {
    const { svc, prisma, notifications, claimed } = setup(120, 3);
    expect(await svc.run({ now: MONDAY_10 })).toMatchObject({
      zones: 1,
      sent: 1,
      emailed: 1,
    });
    expect(await svc.run({ now: MONDAY_10 })).toMatchObject({
      sent: 0,
      alreadySent: 1,
    });
    expect([...claimed]).toEqual(['weekly_recap:u1:2026-10-12']);
    // Range = the previous local week [Mon 05 03:00Z, Mon 12 03:00Z).
    expect(prisma.xpEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: ['u1'] },
          createdAt: {
            gte: new Date('2026-10-05T03:00:00Z'),
            lt: new Date('2026-10-12T03:00:00Z'),
          },
        },
      }),
    );
    const build = (notifications.notify.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { kind: string; body: string; emailLines: string[] };
    const msg = build({ locale: 'en-US' });
    expect(msg.kind).toBe('WEEKLY_RECAP');
    expect(msg.body).toContain('120 XP');
    expect(msg.emailLines).toContain('Current streak: 4 days');
  });

  it('sends nothing to users with no activity last week', async () => {
    const { svc, notifications } = setup(0, 0);
    expect(await svc.run({ now: MONDAY_10 })).toMatchObject({
      noActivity: 1,
      sent: 0,
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('respects emailEnabled through the query filter', async () => {
    const { svc, prisma } = setup(10, 1);
    await svc.run({ now: MONDAY_10 });
    const call = (
      prisma.user.findMany.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][]
    ).find((c) => c[0].where && 'notificationPrefs' in c[0].where);
    expect(call?.[0].where['notificationPrefs']).toEqual({
      none: { kind: 'WEEKLY_RECAP', emailEnabled: false },
    });
  });
});
