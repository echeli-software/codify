import { BadRequestException } from '@nestjs/common';
import { GamificationService } from './gamification.service.js';
import { GamificationConfigService } from './gamification-config.service.js';
import { makeFakeLedgerDb } from './testing/fake-ledger-db.js';
import type { GrantRewardParams } from './gamification.types.js';

function setup(opts: Parameters<typeof makeFakeLedgerDb>[0]) {
  const fake = makeFakeLedgerDb(opts);
  const leagues = { accumulateXp: jest.fn(async () => undefined) };
  const config = new GamificationConfigService(fake.db as never);
  // Premium resolution is AccessService's job (tested in billing); here
  // every user is a free user.
  const access = { hasActiveSubscription: jest.fn(async () => false) };
  const svc = new GamificationService(
    fake.db as never,
    leagues as never,
    config,
    access as never,
  );
  return { ...fake, svc, leagues, access };
}

const lesson = (over: Partial<GrantRewardParams> = {}): GrantRewardParams => ({
  userId: 'u1',
  baseXp: 10,
  baseCoins: 5,
  xpSource: 'LESSON_COMPLETE',
  coinSource: 'LESSON_COMPLETE',
  ...over,
});

/** Ledger invariant: each balanceAfter = previous balanceAfter + delta. */
function expectChained(rows: { delta: number; balanceAfter: number }[]) {
  let bal = 0;
  for (const r of rows) {
    bal += r.delta;
    expect(r.balanceAfter).toBe(bal);
  }
  return bal;
}

describe('GamificationService ledger', () => {
  it('concurrent purchases cannot overdraw; balanceAfter chains', async () => {
    const { svc, users, coinTx } = setup({
      users: [{ id: 'u1', coins: 100, totalXp: 0, timezone: 'UTC' }],
    });
    const spend = (key: string) =>
      svc.spendCoins({
        userId: 'u1',
        amount: 60,
        source: 'ITEM_PURCHASE',
        idempotencyKey: key,
      });
    const results = await Promise.allSettled([
      spend('a'),
      spend('b'),
      spend('c'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed)
      expect((f as PromiseRejectedResult).reason).toBeInstanceOf(
        BadRequestException,
      );
    expect(users.get('u1')!.coins).toBe(40);
    // opening balance (100) + one -60 spend
    expect(coinTx.map((c) => c.delta)).toEqual([100, -60]);
    expect(expectChained(coinTx)).toBe(40);
  });

  it('concurrent grants serialize and chain balanceAfter without gaps', async () => {
    const { svc, users, coinTx } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        svc.grantReward(lesson({ idempotencyKey: `k${i}`, flat: true })),
      ),
    );
    expect(users.get('u1')!.coins).toBe(25);
    expect(coinTx).toHaveLength(5);
    expect(new Set(coinTx.map((c) => c.balanceAfter))).toEqual(
      new Set([5, 10, 15, 20, 25]),
    );
    expect(expectChained(coinTx)).toBe(25);
  });

  it('spend + grant racing for one user keep the ledger consistent', async () => {
    const { svc, users, coinTx } = setup({
      users: [{ id: 'u1', coins: 50, totalXp: 0, timezone: 'UTC' }],
    });
    await Promise.all([
      svc.spendCoins({ userId: 'u1', amount: 30, source: 'ITEM_PURCHASE' }),
      svc.grantReward(lesson({ idempotencyKey: 'g', flat: true })),
      svc.spendCoins({ userId: 'u1', amount: 20, source: 'ITEM_PURCHASE' }),
    ]);
    expect(users.get('u1')!.coins).toBe(5);
    expect(expectChained(coinTx)).toBe(5);
  });

  it('conditional decrement is a second guard when the balance moved', async () => {
    const tx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUniqueOrThrow: jest.fn(async () => ({ coins: 100 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      coinTransaction: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => ({ id: 'x' })),
        create: jest.fn(),
      },
    };
    const svc = new GamificationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      svc.spendCoins(
        { userId: 'u1', amount: 60, source: 'ITEM_PURCHASE' },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
  });

  it('spend replay with the same idempotency key charges once', async () => {
    const { svc, users } = setup({
      users: [{ id: 'u1', coins: 100, totalXp: 0, timezone: 'UTC' }],
    });
    const p = {
      userId: 'u1',
      amount: 30,
      source: 'ITEM_PURCHASE' as const,
      idempotencyKey: 'buy:1',
    };
    await svc.spendCoins(p);
    const again = await svc.spendCoins(p);
    expect(again.spent).toBe(0);
    expect(users.get('u1')!.coins).toBe(70);
  });

  it('capAtBalance clawbacks take at most the balance and never go negative', async () => {
    const { svc, users, coinTx } = setup({
      users: [{ id: 'u1', coins: 120, totalXp: 0, timezone: 'UTC' }],
    });
    const res = await svc.spendCoins({
      userId: 'u1',
      amount: 300,
      source: 'PURCHASE_REFUND',
      idempotencyKey: 'billing_bonus_clawback:s1',
      capAtBalance: true,
    });
    expect(res).toEqual({ coins: 0, spent: 120 });
    expect(users.get('u1')?.coins).toBe(0);
    expect(coinTx.at(-1)).toMatchObject({
      delta: -120,
      source: 'PURCHASE_REFUND',
      balanceAfter: 0,
    });
    // Empty balance: nothing to take, no ledger row, no error.
    await expect(
      svc.spendCoins({
        userId: 'u1',
        amount: 300,
        source: 'PURCHASE_REFUND',
        capAtBalance: true,
      }),
    ).resolves.toEqual({ coins: 0, spent: 0 });
    // Without the flag an over-balance spend still fails.
    await expect(
      svc.spendCoins({ userId: 'u1', amount: 1, source: 'ITEM_PURCHASE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('coin-only reward replays are idempotent (coin journal key checked)', async () => {
    const { svc, users, coinTx } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    const p = lesson({
      baseXp: 0,
      baseCoins: 20,
      idempotencyKey: 'quest:1',
      flat: true,
    });
    await svc.grantReward(p);
    const replay = await svc.grantReward(p);
    expect(replay.coins).toBe(0);
    expect(users.get('u1')!.coins).toBe(20);
    expect(coinTx).toHaveLength(1);
  });
});

describe('GamificationService streak milestones', () => {
  const yesterdayUtc = () => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1),
    );
  };

  it('pays the 7-day milestone the first time it is reached', async () => {
    const { svc, users, streaks } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 6,
      longestDays: 6,
      freezesAvailable: 0,
      lastActivityDate: yesterdayUtc(),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l1', countsForStreak: true }),
    );
    expect(r.streak?.currentDays).toBe(7);
    expect(r.streakMilestone).toEqual({ days: 7, xp: 0, coins: 50 });
    expect(users.get('u1')!.coins).toBe(55);
    expect(r.totals.coins).toBe(55);
  });

  it('re-hitting an already-paid milestone is skipped, not a 500', async () => {
    const { svc, users, coinTx, streaks } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    // The 7-day milestone (coin-only → no XpEvent) was paid on an earlier run.
    await svc.grantReward({
      userId: 'u1',
      baseXp: 0,
      baseCoins: 50,
      xpSource: 'STREAK_MILESTONE',
      coinSource: 'STREAK_MILESTONE',
      idempotencyKey: 'streak_milestone:u1:7',
      flat: true,
    });
    // Streak broke and was rebuilt to 6; today's lesson makes it 7 again.
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 6,
      longestDays: 30,
      freezesAvailable: 0,
      lastActivityDate: yesterdayUtc(),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l2', countsForStreak: true }),
    );
    expect(r.streak?.currentDays).toBe(7);
    expect(r.streakMilestone).toBeNull();
    expect(users.get('u1')!.coins).toBe(55);
    expect(coinTx.filter((c) => c.source === 'STREAK_MILESTONE')).toHaveLength(
      1,
    );
  });

  it('uses the admin-configured milestone table', async () => {
    const { svc, streaks } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      config: { 'streak.milestones': { '3': { xp: 5, coins: 7 } } },
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 2,
      longestDays: 2,
      freezesAvailable: 0,
      lastActivityDate: yesterdayUtc(),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l1', countsForStreak: true }),
    );
    expect(r.streakMilestone).toEqual({ days: 3, xp: 5, coins: 7 });
  });
});

const dayKeyAgo = (n: number) => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n),
  );
};

describe('GamificationService streak settlement on grant (FIX-7)', () => {
  it('a gap covered by a freeze keeps the streak and reports the freeze', async () => {
    const { svc, streaks } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 4,
      longestDays: 4,
      freezesAvailable: 1,
      lastActivityDate: dayKeyAgo(2),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l1', countsForStreak: true }),
    );
    expect(r.streak).toMatchObject({
      currentDays: 5,
      freezesAvailable: 0,
      freezesUsed: 1,
      extended: true,
      restartedAfterLoss: false,
    });
  });

  it('a lost streak restarts at 1 (restartedAfterLoss)', async () => {
    const { svc, streaks } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 9,
      longestDays: 9,
      freezesAvailable: 0,
      lastActivityDate: dayKeyAgo(3),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l1', countsForStreak: true }),
    );
    expect(r.streak).toMatchObject({
      currentDays: 1,
      longestDays: 9,
      restartedAfterLoss: true,
    });
  });

  it('getSummary shows the effective streak, not the stale row', async () => {
    const { svc, streaks, db } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    Object.assign(db, {
      coinBonusPool: { findUnique: async () => ({ coins: 30 }) },
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 12,
      longestDays: 12,
      freezesAvailable: 0,
      lastActivityDate: dayKeyAgo(2),
    });
    const s = await svc.getSummary('u1');
    expect(s.streak).toMatchObject({ currentDays: 0, longestDays: 12 });
    expect(s.weeklyBonusPool.coins).toBe(30);
  });
});

describe('GamificationService daily coin caps + weekly pool (ECO-2)', () => {
  it('caps LESSON_COMPLETE at 200/day; the excess goes to the pool; reports it', async () => {
    const { svc, users, pools } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    for (let i = 0; i < 3; i++)
      await svc.grantReward(
        lesson({ baseCoins: 60, idempotencyKey: `a${i}`, flat: true }),
      );
    const r = await svc.grantReward(
      lesson({ baseCoins: 60, idempotencyKey: 'a3', flat: true }),
    );
    expect(r.coins).toBe(20);
    expect(r.coinCap).toEqual({ requested: 60, pooled: 40, dropped: 0 });
    expect(r.breakdown).toContainEqual({
      source: 'DAILY_CAP',
      coins: -40,
      pooled: 40,
    });
    expect(users.get('u1')!.coins).toBe(200);
    expect([...pools.values()]).toEqual([40]);
  });

  it('a full pool drops the rest; uncapped / unlisted sources are never capped', async () => {
    const { svc, pools } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      config: {
        'coins.dailyCaps': { LESSON_COMPLETE: 10 },
        'coins.weeklyPoolCap': 15,
      },
    });
    const r = await svc.grantReward(
      lesson({ baseCoins: 40, idempotencyKey: 'x', flat: true }),
    );
    expect(r).toMatchObject({
      coins: 10,
      coinCap: { pooled: 15, dropped: 15 },
    });
    expect([...pools.values()]).toEqual([15]);
    const free = await svc.grantReward(
      lesson({
        baseCoins: 40,
        idempotencyKey: 'y',
        flat: true,
        coinSource: 'DAILY_QUEST',
      }),
    );
    expect(free.coins).toBe(40);
    const bypass = await svc.grantReward(
      lesson({
        baseCoins: 40,
        idempotencyKey: 'z',
        flat: true,
        uncapped: true,
      }),
    );
    expect(bypass.coins).toBe(40);
  });
});

describe('GamificationService analytics + breakdown (ECO-5, ECO-13)', () => {
  it('writes reward_granted with the effective multiplier', async () => {
    const { svc, analytics } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      multipliers: [{ kind: 'CAMPAIGN', value: 2, target: 'BOTH' }],
    });
    await svc.grantReward(lesson({ idempotencyKey: 'k', lessonId: 'L1' }));
    expect(analytics[0]).toMatchObject({
      name: 'reward_granted',
      userId: 'u1',
      props: expect.objectContaining({
        source: 'LESSON_COMPLETE',
        xp: 20,
        coins: 10,
        multiplierEffective: 2,
        multiplierCapped: false,
        lessonId: 'L1',
      }),
    });
  });

  it('lists coin-only factors with appliesTo so the toast can show them', async () => {
    const { svc } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      multipliers: [
        { kind: 'CAMPAIGN', value: 2, target: 'XP' },
        { kind: 'COURSE_PROMO', value: 4, target: 'COINS', courseId: 'C1' },
      ],
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'k', courseId: 'C1' }),
    );
    expect(r).toMatchObject({ xp: 20, coins: 20, coinMultiplier: 4 });
    expect(r.breakdown).toEqual([
      { source: 'base', xp: 10, coins: 5 },
      { source: 'CAMPAIGN', multiplier: 2, appliesTo: 'xp' },
      { source: 'COURSE_PROMO', multiplier: 4, appliesTo: 'coins' },
    ]);
  });

  it("never applies another user's surprise boost", async () => {
    const now = Date.now();
    const { svc } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      multipliers: [
        {
          kind: 'SURPRISE_BOOST',
          value: 2,
          target: 'XP',
          userId: 'u2',
          startsAt: new Date(now - 60_000),
          endsAt: new Date(now + 600_000),
        },
      ],
    });
    const r = await svc.grantReward(lesson({ idempotencyKey: 'k' }));
    expect(r.xp).toBe(10);
  });
});

describe('GamificationService surprise boosts (ECO-9)', () => {
  it('starts a 15-min 2x XP boost on a lucky roll, at most 2 per week', async () => {
    const { svc, db, multipliers } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    svc.random = () => 0; // always lucky
    const t0 = new Date('2026-11-07T10:00:00Z');
    const b1 = await svc.maybeStartSurpriseBoost(db as never, 'u1', t0);
    expect(b1).toMatchObject({ value: 2, target: 'XP' });
    expect(Date.parse(b1!.endsAt) - t0.getTime()).toBe(15 * 60_000);
    // While one runs, no second one.
    expect(
      await svc.maybeStartSurpriseBoost(
        db as never,
        'u1',
        new Date(t0.getTime() + 60_000),
      ),
    ).toBeNull();
    const later = new Date(t0.getTime() + 60 * 60_000);
    // createdAt of the fake rows is "now" (real clock); keep them in-window.
    for (const m of multipliers) m.createdAt = t0;
    expect(
      await svc.maybeStartSurpriseBoost(db as never, 'u1', later),
    ).not.toBeNull();
    for (const m of multipliers) m.createdAt = t0;
    expect(
      await svc.maybeStartSurpriseBoost(
        db as never,
        'u1',
        new Date(later.getTime() + 60 * 60_000),
      ),
    ).toBeNull();
  });

  it('an unlucky roll starts nothing', async () => {
    const { svc, db } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    svc.random = () => 0.99;
    expect(await svc.maybeStartSurpriseBoost(db as never, 'u1')).toBeNull();
  });
});

describe('GamificationService exclusive milestone cosmetics (ECO-8)', () => {
  it('grants the 30-day item once with the milestone', async () => {
    const { svc, streaks, userItems } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      items: [{ id: 'i30', slug: 'streak-30-flame-frame', name: 'Flame' }],
    });
    streaks.set('u1', {
      userId: 'u1',
      currentDays: 29,
      longestDays: 29,
      freezesAvailable: 0,
      lastActivityDate: dayKeyAgo(1),
    });
    const r = await svc.grantReward(
      lesson({ idempotencyKey: 'l1', countsForStreak: true }),
    );
    expect(r.streakMilestone).toMatchObject({
      days: 30,
      coins: 200,
      item: { id: 'i30', slug: 'streak-30-flame-frame' },
    });
    expect(userItems).toEqual([
      { userId: 'u1', itemId: 'i30', source: 'PROMO' },
    ]);
  });
});

describe('GamificationService staff grants', () => {
  it('ADMIN_GRANT is never held back by the daily caps, even when listed', async () => {
    const { svc, users, pools } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
      // A manual DB edit that lists ADMIN_GRANT is invalid → defaults apply.
      config: { 'coins.dailyCaps': { ADMIN_GRANT: 1, LESSON_COMPLETE: 1 } },
    });
    const r = await svc.grantReward(
      lesson({
        baseCoins: 900,
        xpSource: 'ADMIN_GRANT',
        coinSource: 'ADMIN_GRANT',
        idempotencyKey: 'g1',
        flat: true,
      }),
    );
    expect(r.coins).toBe(900);
    expect(r.coinCap).toBeNull();
    expect(users.get('u1')!.coins).toBe(900);
    expect(pools.size).toBe(0);
  });

  it('staff-granted XP does not count toward the weekly league; earned XP does', async () => {
    const { svc, leagues } = setup({
      users: [{ id: 'u1', coins: 0, totalXp: 0, timezone: 'UTC' }],
    });
    await svc.grantReward(
      lesson({
        baseXp: 500,
        xpSource: 'ADMIN_GRANT',
        coinSource: 'ADMIN_GRANT',
        idempotencyKey: 'g2',
        flat: true,
      }),
    );
    expect(leagues.accumulateXp).not.toHaveBeenCalled();
    await svc.grantReward(lesson({ idempotencyKey: 'l9', flat: true }));
    expect(leagues.accumulateXp).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      10,
    );
  });
});
