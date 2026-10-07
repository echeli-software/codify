import { Prisma } from '@prisma/client';
import type { PushService } from './push.service.js';
import { StreakReminderService } from './streak-reminder.service.js';

interface StreakRow {
  currentDays: number;
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
): StreakRow {
  return {
    currentDays: days,
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
  const push = {
    deliver: jest.fn(async (msgs: unknown[]) => ({
      sent: msgs.length,
      failed: 0,
      invalidTokens: [],
      pruned: 0,
    })),
  };
  return {
    prisma,
    push,
    claimed,
    svc: new StreakReminderService(
      prisma as never,
      push as unknown as PushService,
    ),
  };
}

// 23:30 UTC on Oct 7 = 20:30 in São Paulo → inside the evening slot.
const EVENING = new Date('2026-10-07T23:30:00Z');
// 15:00 UTC = 12:00 São Paulo → outside the slot.
const NOON = new Date('2026-10-07T15:00:00Z');

describe('StreakReminderService', () => {
  it('manual mode reminds every at-risk user regardless of the time', async () => {
    const { svc, push } = setup([
      streak('risk', '2026-10-05'),
      streak('ok', '2026-10-07'),
    ]);
    const res = await svc.run({ mode: 'manual', now: NOON });
    expect(res).toEqual({ candidates: 1, pushed: 1, pruned: 0 });
    const msgs = push.deliver.mock.calls[0][0] as {
      token: string;
      data: Record<string, string>;
      body: string;
    }[];
    expect(msgs[0]).toMatchObject({
      token: 'tok-risk',
      data: { type: 'streak_reminder', streakDays: '5' },
    });
    expect(msgs[0].body).toMatch(/dias seguidos/);
  });

  it('treats a streak advanced today (UTC-midnight date) as safe in a UTC-3 zone', async () => {
    // Regression: converting 2026-10-07T00:00Z to São Paulo gives Oct 6.
    const { svc } = setup([streak('acted-today', '2026-10-07')]);
    expect((await svc.run({ mode: 'manual', now: EVENING })).candidates).toBe(
      0,
    );
  });

  it('scheduled mode only reaches users in their local evening slot', async () => {
    const tokyo = streak('tokyo', '2026-10-05', {
      timezone: 'Asia/Tokyo',
      locale: 'en',
    }); // 08:30 local
    const { svc } = setup([streak('sp', '2026-10-05'), tokyo]);
    const res = await svc.run({ mode: 'scheduled', now: EVENING });
    expect(res).toMatchObject({ candidates: 1, pushed: 1 });
    expect(
      (
        await setup([streak('sp', '2026-10-05')]).svc.run({
          mode: 'scheduled',
          now: NOON,
        })
      ).candidates,
    ).toBe(0);
  });

  it('scheduled mode skips users whose quiet hours cover the slot', async () => {
    const { svc } = setup([
      streak('early-sleeper', '2026-10-05', {
        quietHoursStart: 20 * 60,
        quietHoursEnd: 7 * 60,
      }),
    ]);
    const res = await svc.run({ mode: 'scheduled', now: EVENING });
    expect(res).toMatchObject({ candidates: 0, skippedQuietHours: 1 });
  });

  it('scheduled mode is idempotent per user per local day', async () => {
    const { svc, prisma, claimed } = setup([streak('sp', '2026-10-05')]);
    await svc.run({ mode: 'scheduled', now: EVENING });
    const second = await svc.run({
      mode: 'scheduled',
      now: new Date('2026-10-08T00:30:00Z'),
    }); // 21:30 local
    expect(second).toMatchObject({ candidates: 0, alreadyReminded: 1 });
    expect([...claimed]).toEqual(['streak_reminder:sp:2026-10-07']);
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledTimes(2);
  });
});
