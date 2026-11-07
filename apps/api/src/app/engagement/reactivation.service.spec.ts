import type { NotificationService } from '../notifications/notification.service.js';
import {
  ReactivationService,
  WINBACK_DEEP_LINK,
  stageFor,
} from './reactivation.service.js';
import type { WelcomeBackQuest } from './welcome-back-quest.js';

const NOW = new Date('2026-10-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

interface U {
  id: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  reactivationStage: number;
  dormantAt?: Date | null;
}

function setup(users: U[], subscribed: string[] = []) {
  const db = users.map((u) => ({ dormantAt: null, ...u }));
  const prisma = {
    user: {
      findMany: jest.fn(async ({ cursor }: { cursor?: { id: string } }) =>
        cursor
          ? []
          : db
              .filter((u) => !u.dormantAt && u.reactivationStage < 90)
              .map((u) => ({ ...u })),
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            reactivationStage: number;
            lastSeenAt: Date | null;
          };
          data: { reactivationStage: number; dormantAt?: Date };
        }) => {
          const u = db.find(
            (x) =>
              x.id === where.id &&
              x.reactivationStage === where.reactivationStage &&
              x.lastSeenAt === where.lastSeenAt &&
              !x.dormantAt,
          );
          if (!u) return { count: 0 };
          Object.assign(u, data);
          return { count: 1 };
        },
      ),
    },
    subscription: {
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
        subscribed.includes(where.userId) ? { id: 's1' } : null,
      ),
    },
  };
  const notifications = {
    notify: jest.fn(async () => ({ status: 'ok' })),
  };
  const welcomeBack = {
    template: jest.fn(async (locale: string) => ({
      id: `tpl-${locale}`,
      coinReward: locale === 'pt-BR' ? 150 : 200,
    })),
  };
  const svc = new ReactivationService(
    prisma as never,
    notifications as unknown as NotificationService,
    welcomeBack as unknown as WelcomeBackQuest,
  );
  return { svc, db, notifications, prisma };
}

type Build = (u: { locale: string; displayName: string }) => {
  kind: string;
  title: string;
  body: string;
  deepLink?: string;
};

describe('stageFor', () => {
  it('maps days lapsed to the docs/10 §13 stages', () => {
    expect([0, 6, 7, 13, 14, 29, 30, 89, 90, 400].map(stageFor)).toEqual([
      0, 0, 7, 7, 14, 14, 30, 30, 90, 90,
    ]);
  });
});

describe('ReactivationService', () => {
  it('sends one message per stage and is idempotent across runs', async () => {
    const { svc, db, notifications } = setup([
      {
        id: 'd7',
        lastSeenAt: daysAgo(8),
        createdAt: daysAgo(60),
        reactivationStage: 0,
      },
      {
        id: 'd14',
        lastSeenAt: daysAgo(15),
        createdAt: daysAgo(60),
        reactivationStage: 7,
      },
      {
        id: 'd30',
        lastSeenAt: daysAgo(31),
        createdAt: daysAgo(60),
        reactivationStage: 14,
      },
      {
        id: 'd90',
        lastSeenAt: daysAgo(91),
        createdAt: daysAgo(200),
        reactivationStage: 30,
      },
    ]);
    const first = await svc.run(NOW);
    expect(first).toMatchObject({ day7: 1, day14: 1, day30: 1, dormant: 1 });
    expect(db.map((u) => u.reactivationStage)).toEqual([7, 14, 30, 90]);
    expect(db[3].dormantAt).toEqual(NOW);
    const calls = notifications.notify.mock.calls as unknown as [
      string,
      Build,
      { channels: Record<string, boolean> },
    ][];
    expect(calls.map((c) => [c[0], c[2].channels])).toEqual([
      ['d7', { push: false, email: true }],
      ['d14', { push: true, email: false }],
      ['d30', { push: true, email: true }],
    ]);
    expect(calls[1][1]({ locale: 'en-US', displayName: 'A' }).body).toContain(
      '200 coins',
    );
    expect(calls[2][1]({ locale: 'pt-BR', displayName: 'A' }).deepLink).toBe(
      WINBACK_DEEP_LINK,
    );

    const second = await svc.run(NOW);
    expect(second).toMatchObject({ day7: 0, day14: 0, day30: 0, dormant: 0 });
    expect(notifications.notify).toHaveBeenCalledTimes(3);
  });

  it('jumps straight to the highest stage reached (no burst of old stages)', async () => {
    const { svc, db, notifications } = setup([
      {
        id: 'late',
        lastSeenAt: daysAgo(40),
        createdAt: daysAgo(60),
        reactivationStage: 0,
      },
      {
        id: 'never',
        lastSeenAt: null,
        createdAt: daysAgo(10),
        reactivationStage: 0,
      },
    ]);
    const res = await svc.run(NOW);
    expect(res).toMatchObject({ day7: 1, day14: 0, day30: 1 });
    expect(db.map((u) => u.reactivationStage)).toEqual([30, 7]);
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('skips the day-30 offer for subscribers but still advances the stage', async () => {
    const { svc, db, notifications } = setup(
      [
        {
          id: 'paying',
          lastSeenAt: daysAgo(31),
          createdAt: daysAgo(90),
          reactivationStage: 14,
        },
      ],
      ['paying'],
    );
    expect(await svc.run(NOW)).toMatchObject({ day30: 0, day30Subscribed: 1 });
    expect(db[0].reactivationStage).toBe(30);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('leaves a user alone when the stage claim loses (they came back meanwhile)', async () => {
    const { svc, prisma, notifications } = setup([
      {
        id: 'back',
        lastSeenAt: daysAgo(8),
        createdAt: daysAgo(60),
        reactivationStage: 0,
      },
    ]);
    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await svc.run(NOW);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
