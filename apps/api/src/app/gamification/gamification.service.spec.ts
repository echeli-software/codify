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
