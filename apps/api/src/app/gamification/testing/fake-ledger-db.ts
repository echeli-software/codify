/**
 * In-memory stand-in for the slice of Prisma the reward ledger touches, used
 * by unit tests. Every call yields to the event loop so concurrent
 * transactions genuinely interleave, and `$queryRaw … FOR UPDATE` is modelled
 * as a per-user mutex held until the transaction callback settles — enough to
 * prove the ledger serializes concurrent writers for one user.
 */

export interface FakeUser {
  id: string;
  coins: number;
  totalXp: number;
  timezone: string;
}

export interface FakeCoinTx {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  source: string;
  idempotencyKey: string | null;
  refType: string | null;
  createdAt?: Date;
}

export interface FakeMultiplier {
  id: string;
  kind: string;
  target: 'XP' | 'COINS' | 'BOTH';
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  courseId: string | null;
  lessonId: string | null;
  streakDaysMin: number | null;
  userId: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface FakeXpEvent {
  id: string;
  userId: string;
  amount: number;
  idempotencyKey: string | null;
}

export interface FakeStreak {
  userId: string;
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  lastActivityDate: Date;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

export function makeFakeLedgerDb(opts: {
  users: FakeUser[];
  config?: Record<string, unknown>;
  /** When false, `FOR UPDATE` is a no-op (to show the second guard). */
  locking?: boolean;
  multipliers?: Partial<FakeMultiplier>[];
  items?: { id: string; slug: string; name: string }[];
}) {
  const locking = opts.locking ?? true;
  const users = new Map(opts.users.map((u) => [u.id, { ...u }]));
  const coinTx: FakeCoinTx[] = [];
  const xpEvents: FakeXpEvent[] = [];
  const streaks = new Map<string, FakeStreak>();
  const config = new Map(Object.entries(opts.config ?? {}));
  const locks = new Map<string, Promise<void>>();
  const analytics: { name: string; userId: string; props: unknown }[] = [];
  const pools = new Map<string, number>();
  const userItems: { userId: string; itemId: string; source: string }[] = [];
  const items = opts.items ?? [];
  let seq = 0;
  const multipliers: FakeMultiplier[] = (opts.multipliers ?? []).map(
    (m, i) => ({
      id: `m${i}`,
      kind: 'CAMPAIGN',
      target: 'BOTH',
      value: 2,
      startsAt: null,
      endsAt: null,
      courseId: null,
      lessonId: null,
      streakDaysMin: null,
      userId: null,
      description: null,
      isActive: true,
      createdAt: new Date(),
      ...m,
    }),
  );
  const poolKey = (w: { userId: string; weekStart: Date }) =>
    `${w.userId}|${w.weekStart.toISOString()}`;
  const id = () => `id-${++seq}`;

  function unique(
    rows: { idempotencyKey: string | null }[],
    key: string | null,
  ) {
    if (key && rows.some((r) => r.idempotencyKey === key)) {
      const err = new Error(
        `Unique constraint failed on idempotencyKey ${key}`,
      );
      (err as Error & { code: string }).code = 'P2002';
      throw err;
    }
  }

  function makeTx(held: Map<string, () => void>) {
    return {
      $queryRaw: async (_strings: TemplateStringsArray, userId: string) => {
        if (!locking || held.has(userId)) return [{ id: userId }];
        const prev = locks.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((r) => (release = r));
        locks.set(
          userId,
          prev.then(() => mine),
        );
        await prev;
        held.set(userId, release);
        return [{ id: userId }];
      },
      user: {
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
          await tick();
          const u = users.get(where.id);
          if (!u) throw new Error('not found');
          return { ...u };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            totalXp?: { increment: number };
            coins?: { increment: number };
          };
        }) => {
          await tick();
          const u = users.get(where.id)!;
          u.totalXp += data.totalXp?.increment ?? 0;
          u.coins += data.coins?.increment ?? 0;
          return { totalXp: u.totalXp, coins: u.coins };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; coins: { gte: number } };
          data: { coins: { decrement: number } };
        }) => {
          await tick();
          const u = users.get(where.id);
          if (!u || u.coins < where.coins.gte) return { count: 0 };
          u.coins -= data.coins.decrement;
          return { count: 1 };
        },
      },
      coinTransaction: {
        findUnique: async ({
          where,
        }: {
          where: { idempotencyKey: string };
        }) => {
          await tick();
          return (
            coinTx.find((c) => c.idempotencyKey === where.idempotencyKey) ??
            null
          );
        },
        findFirst: async ({ where }: { where: { userId: string } }) => {
          await tick();
          return coinTx.find((c) => c.userId === where.userId) ?? null;
        },
        create: async ({ data }: { data: Omit<FakeCoinTx, 'id'> }) => {
          await tick();
          unique(coinTx, data.idempotencyKey ?? null);
          const row = {
            ...data,
            id: id(),
            idempotencyKey: data.idempotencyKey ?? null,
            refType: data.refType ?? null,
            createdAt: new Date(),
          };
          coinTx.push(row);
          return row;
        },
        aggregate: async ({
          where,
        }: {
          where: { userId: string; source: string; createdAt: { gte: Date } };
        }) => {
          await tick();
          const sum = coinTx
            .filter(
              (c) =>
                c.userId === where.userId &&
                c.source === where.source &&
                c.delta > 0 &&
                (c.createdAt ?? new Date()) >= where.createdAt.gte,
            )
            .reduce((a, c) => a + c.delta, 0);
          return { _sum: { delta: sum || null } };
        },
      },
      coinBonusPool: {
        findUnique: async ({
          where,
        }: {
          where: { userId_weekStart: { userId: string; weekStart: Date } };
        }) => {
          const v = pools.get(poolKey(where.userId_weekStart));
          return v === undefined ? null : { coins: v };
        },
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { userId_weekStart: { userId: string; weekStart: Date } };
          create: { coins: number };
          update: { coins: { increment: number } };
        }) => {
          const k = poolKey(where.userId_weekStart);
          const cur = pools.get(k);
          pools.set(
            k,
            cur === undefined ? create.coins : cur + update.coins.increment,
          );
          return { coins: pools.get(k) };
        },
      },
      analyticsEvent: {
        create: async ({
          data,
        }: {
          data: { name: string; userId: string; props: unknown };
        }) => {
          analytics.push(data);
          return data;
        },
      },
      item: {
        findUnique: async ({ where }: { where: { slug: string } }) => {
          const it = items.find((i) => i.slug === where.slug);
          return it ? { ...it, deletedAt: null } : null;
        },
      },
      userItem: {
        createMany: async ({
          data,
        }: {
          data: { userId: string; itemId: string; source: string }[];
        }) => {
          let count = 0;
          for (const d of data) {
            if (
              userItems.some(
                (u) => u.userId === d.userId && u.itemId === d.itemId,
              )
            )
              continue;
            userItems.push(d);
            count += 1;
          }
          return { count };
        },
      },
      xpEvent: {
        findUnique: async ({
          where,
        }: {
          where: { idempotencyKey: string };
        }) => {
          await tick();
          return (
            xpEvents.find((x) => x.idempotencyKey === where.idempotencyKey) ??
            null
          );
        },
        create: async ({ data }: { data: Omit<FakeXpEvent, 'id'> }) => {
          await tick();
          unique(xpEvents, data.idempotencyKey ?? null);
          const row = {
            ...data,
            id: id(),
            idempotencyKey: data.idempotencyKey ?? null,
          };
          xpEvents.push(row);
          return row;
        },
      },
      streak: {
        findUnique: async ({ where }: { where: { userId: string } }) => {
          await tick();
          const s = streaks.get(where.userId);
          return s ? { ...s } : null;
        },
        create: async ({ data }: { data: FakeStreak }) => {
          await tick();
          streaks.set(data.userId, { ...data });
          return { ...data };
        },
        update: async ({
          where,
          data,
        }: {
          where: { userId: string };
          data: Partial<FakeStreak>;
        }) => {
          await tick();
          const s = { ...streaks.get(where.userId)!, ...data };
          streaks.set(where.userId, s);
          return { ...s };
        },
      },
      multiplier: {
        findMany: async ({
          where,
        }: {
          where: { OR?: { userId: string | null }[] };
        }) => {
          const ids = where.OR?.map((o) => o.userId) ?? [null];
          return multipliers
            .filter((m) => m.isActive && ids.includes(m.userId))
            .map((m) => ({ ...m }));
        },
        findFirst: async ({
          where,
        }: {
          where: {
            userId: string;
            kind: string;
            startsAt: { lte: Date };
            endsAt: { gt: Date };
          };
        }) =>
          multipliers.find(
            (m) =>
              m.userId === where.userId &&
              m.kind === where.kind &&
              m.isActive &&
              m.startsAt !== null &&
              m.startsAt <= where.startsAt.lte &&
              m.endsAt !== null &&
              m.endsAt > where.endsAt.gt,
          ) ?? null,
        count: async ({
          where,
        }: {
          where: { userId: string; kind: string; createdAt: { gte: Date } };
        }) =>
          multipliers.filter(
            (m) =>
              m.userId === where.userId &&
              m.kind === where.kind &&
              m.createdAt >= where.createdAt.gte,
          ).length,
        create: async ({
          data,
        }: {
          data: Partial<FakeMultiplier> & { value: unknown };
        }) => {
          const row: FakeMultiplier = {
            id: id(),
            kind: 'SURPRISE_BOOST',
            target: 'XP',
            startsAt: null,
            endsAt: null,
            courseId: null,
            lessonId: null,
            streakDaysMin: null,
            userId: null,
            description: null,
            isActive: true,
            createdAt: new Date(),
            ...data,
            value: Number(data.value),
          };
          multipliers.push(row);
          return { ...row };
        },
      },
      subscription: { findMany: async () => [] },
      gamificationConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          config.has(where.key)
            ? { key: where.key, value: config.get(where.key) }
            : null,
        findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in
            .filter((k) => config.has(k))
            .map((k) => ({
              key: k,
              value: config.get(k),
              updatedAt: new Date(),
            })),
      },
    };
  }

  const root = {
    ...makeTx(new Map()),
    $transaction: async <T>(
      fn: (tx: ReturnType<typeof makeTx>) => Promise<T>,
    ) => {
      const held = new Map<string, () => void>();
      try {
        return await fn(makeTx(held));
      } finally {
        for (const release of held.values()) release();
      }
    },
  };

  return {
    db: root,
    users,
    coinTx,
    xpEvents,
    streaks,
    config,
    analytics,
    pools,
    userItems,
    multipliers,
  };
}
