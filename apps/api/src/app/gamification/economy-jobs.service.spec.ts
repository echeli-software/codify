import { EconomyJobsService, promoCopy } from './economy-jobs.service.js';

const NOW = new Date('2026-11-07T15:00:00Z'); // 12:00 São Paulo

function streakRow(
  userId: string,
  last: string,
  over: Record<string, unknown> = {},
) {
  return {
    userId,
    currentDays: 6,
    longestDays: 6,
    freezesAvailable: 0,
    lastActivityDate: new Date(`${last}T00:00:00Z`),
    user: { timezone: 'America/Sao_Paulo' },
    ...over,
  };
}

describe('EconomyJobsService.settleStreaks (FIX-7)', () => {
  it('consumes freezes for missed days and resets lost streaks, conditionally', async () => {
    const rows = [
      streakRow('alive', '2026-11-06'), // yesterday → untouched
      streakRow('frozen', '2026-11-05', { freezesAvailable: 2 }),
      streakRow('lost', '2026-11-04'),
      streakRow('raced', '2026-11-04'),
    ];
    const updates: {
      where: { userId: string };
      data: Record<string, unknown>;
    }[] = [];
    const events: string[] = [];
    const prisma = {
      streak: {
        findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
        updateMany: jest.fn(
          async (args: {
            where: { userId: string };
            data: Record<string, unknown>;
          }) => {
            updates.push(args);
            return { count: args.where.userId === 'raced' ? 0 : 1 };
          },
        ),
      },
      analyticsEvent: {
        create: jest.fn(
          async ({ data }: { data: { name: string; userId: string } }) => {
            events.push(`${data.name}:${data.userId}`);
            return data;
          },
        ),
      },
    };
    const svc = new EconomyJobsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const res = await svc.settleStreaks(NOW);
    expect(res).toEqual({ scanned: 4, frozen: 1, lost: 1 });
    expect(updates.map((u) => u.where.userId)).toEqual([
      'frozen',
      'lost',
      'raced',
    ]);
    expect(updates[0].data).toEqual({
      currentDays: 6,
      freezesAvailable: 1,
      lastActivityDate: new Date('2026-11-06T00:00:00Z'),
    });
    expect(updates[1].data).toMatchObject({
      currentDays: 0,
      freezesAvailable: 0,
    });
    // Optimistic guard on the values read.
    expect(updates[0].where).toMatchObject({
      currentDays: 6,
      freezesAvailable: 2,
    });
    expect(events).toEqual(['streak_freeze_used:frozen', 'streak_lost:lost']);
  });
});

describe('EconomyJobsService.payWeeklyBonusPools (ECO-2)', () => {
  it('pays closed weeks once as WEEKLY_BONUS, uncapped', async () => {
    const paid = new Set<string>();
    const tx = {
      coinBonusPool: {
        updateMany: jest.fn(
          async ({ where }: { where: { userId: string } }) => {
            if (paid.has(where.userId)) return { count: 0 };
            paid.add(where.userId);
            return { count: 1 };
          },
        ),
      },
    };
    const prisma = {
      coinBonusPool: {
        findMany: jest.fn(async () => [
          {
            userId: 'u1',
            weekStart: new Date('2026-10-26T00:00:00Z'),
            coins: 120,
          },
        ]),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const gamification = {
      grantReward: jest.fn(async (p: { baseCoins: number }) => ({
        coins: p.baseCoins,
      })),
    };
    const svc = new EconomyJobsService(
      prisma as never,
      gamification as never,
      {} as never,
    );
    expect(await svc.payWeeklyBonusPools(NOW)).toEqual({
      pools: 1,
      paid: 1,
      coins: 120,
    });
    expect(prisma.coinBonusPool.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paidAt: null,
          weekStart: { lt: new Date('2026-11-02T00:00:00Z') },
        },
      }),
    );
    expect(gamification.grantReward).toHaveBeenCalledWith(
      expect.objectContaining({
        coinSource: 'WEEKLY_BONUS',
        baseCoins: 120,
        uncapped: true,
        idempotencyKey: 'weekly_bonus:u1:2026-10-26T00:00:00.000Z',
      }),
      tx,
    );
    // A rerun finds the pool stamped → no second grant.
    expect((await svc.payWeeklyBonusPools(NOW)).paid).toBe(0);
    expect(gamification.grantReward).toHaveBeenCalledTimes(1);
  });
});

type PromoUser = {
  id: string;
  timezone?: string;
  marketingEmailOptIn?: boolean;
  notificationPrefs?: { pushEnabled: boolean; emailEnabled: boolean }[];
};

function promoSetup(users: PromoUser[]) {
  const claimed = new Set<string>();
  const prisma = {
    multiplier: {
      findMany: jest.fn(async () => [
        {
          id: 'm1',
          kind: 'CAMPAIGN',
          value: 2,
          target: 'XP',
          courseId: null,
          endsAt: new Date('2026-11-09T02:59:00Z'),
        },
      ]),
    },
    contentTranslation: { findMany: jest.fn(async () => []) },
    user: {
      findMany: jest.fn().mockResolvedValueOnce(users).mockResolvedValue([]),
    },
    idempotencyRecord: {
      create: jest.fn(
        async ({ data }: { data: { key: string; scope: string } }) => {
          if (claimed.has(data.key)) {
            const { Prisma } = await import('@prisma/client');
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: '7',
            });
          }
          claimed.add(data.key);
          return data;
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        claimed.delete(where.key);
        return { count: 1 };
      }),
    },
  };
  const notifications = {
    notify: jest.fn(
      async (
        _id: string,
        _c: unknown,
        o: { channels?: { email?: boolean; push?: boolean } },
      ) => ({
        status: 'ok',
        inAppId: o.channels?.email ? null : 'n1',
        push: { status: o.channels?.push === false ? 'not_requested' : 'sent' },
        email: { status: o.channels?.email ? 'sent' : 'not_requested' },
      }),
    ),
  };
  const svc = new EconomyJobsService(
    prisma as never,
    {} as never,
    notifications as never,
  );
  return { svc, prisma, notifications, claimed };
}

type NotifyCall = [
  string,
  (u: { locale: string }) => Record<string, unknown>,
  { channels?: Record<string, boolean> },
];

describe('EconomyJobsService.announcePromotions (ECO-6)', () => {
  it('notifies PROMO opt-ins once per promotion', async () => {
    const { svc, prisma, notifications } = promoSetup([
      {
        id: 'u1',
        notificationPrefs: [{ pushEnabled: true, emailEnabled: true }],
      },
    ]);
    expect(await svc.announcePromotions(NOW)).toEqual({
      promotions: 1,
      notified: 1,
      emailed: 0,
    });
    const where = (
      prisma.user.findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where['OR']).toEqual([
      { notificationPrefs: { some: { kind: 'PROMO', pushEnabled: true } } },
      {
        marketingEmailOptIn: true,
        notificationPrefs: { none: { kind: 'PROMO', emailEnabled: false } },
      },
    ]);
    // Adults only: born on or before 2008-11-07 (18 in every zone today).
    expect(where['birthDate']).toEqual({
      lte: new Date('2008-11-07T00:00:00Z'),
    });
    const [, build, opts] = notifications.notify.mock
      .calls[0] as unknown as NotifyCall;
    expect(opts.channels).toEqual({ email: false });
    expect(build({ locale: 'en-US' })).toMatchObject({
      kind: 'PROMO',
      title: 'Event: 2x XP!',
      action: null,
    });
    // Rerun: the (promotion, user) claim exists → no second notification.
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 'u1',
        notificationPrefs: [{ pushEnabled: true, emailEnabled: true }],
      },
    ]);
    expect((await svc.announcePromotions(NOW)).notified).toBe(0);
  });

  it('emails marketing opt-ins once, on its own claim, with the campaign template', async () => {
    const { svc, prisma, notifications, claimed } = promoSetup([
      // Push + email.
      {
        id: 'both',
        marketingEmailOptIn: true,
        notificationPrefs: [{ pushEnabled: true, emailEnabled: true }],
      },
      // Email only (no PROMO row: email defaults on, consent given).
      { id: 'mail', marketingEmailOptIn: true, timezone: 'America/New_York' },
      // Consent given but PROMO email switched off (unsubscribed).
      {
        id: 'unsub',
        marketingEmailOptIn: true,
        notificationPrefs: [{ pushEnabled: false, emailEnabled: false }],
      },
    ]);
    expect(await svc.announcePromotions(NOW)).toEqual({
      promotions: 1,
      notified: 1,
      emailed: 2,
    });
    expect([...claimed].sort()).toEqual([
      'promo_announce:m1:both',
      'promo_email:m1:both',
      'promo_email:m1:mail',
    ]);
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith({
      data: {
        key: 'promo_email:m1:mail',
        scope: 'promo_email',
        userId: 'mail',
      },
    });
    const calls = notifications.notify.mock.calls as unknown as NotifyCall[];
    const mail = calls.find((c) => c[0] === 'mail');
    expect(mail?.[2].channels).toEqual({
      inApp: false,
      push: false,
      email: true,
    });
    const content = mail?.[1]({ locale: 'pt-BR' });
    expect(content).toMatchObject({
      kind: 'PROMO',
      title: 'Evento bônus: 2x XP no Codify',
      deepLink: '/today',
    });
    expect(content?.['emailLines']).toEqual([
      'Bônus: 2x XP',
      expect.stringMatching(/^Termina: domingo, 8 de novembro/),
    ]);
    // Rerun: both claims exist → nothing more.
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 'both',
        marketingEmailOptIn: true,
        notificationPrefs: [{ pushEnabled: true, emailEnabled: true }],
      },
    ]);
    expect(await svc.announcePromotions(NOW)).toMatchObject({
      notified: 0,
      emailed: 0,
    });
  });

  it('releases the email claim when the send fails so the next run retries', async () => {
    const { svc, notifications, claimed } = promoSetup([
      { id: 'mail', marketingEmailOptIn: true },
    ]);
    notifications.notify.mockResolvedValueOnce({
      status: 'ok',
      inAppId: null,
      push: { status: 'not_requested' },
      email: { status: 'error' },
    } as never);
    expect((await svc.announcePromotions(NOW)).emailed).toBe(0);
    expect(claimed.has('promo_email:m1:mail')).toBe(false);
  });

  it('copy names the course for course promos', () => {
    expect(
      promoCopy('pt-BR', {
        value: 4,
        target: 'COINS',
        courseTitle: 'React',
        endsAt: null,
      }).title,
    ).toBe('4x moedas em React');
  });
});
