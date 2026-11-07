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
}) {
  const locking = opts.locking ?? true;
  const users = new Map(opts.users.map((u) => [u.id, { ...u }]));
  const coinTx: FakeCoinTx[] = [];
  const xpEvents: FakeXpEvent[] = [];
  const streaks = new Map<string, FakeStreak>();
  const config = new Map(Object.entries(opts.config ?? {}));
  const locks = new Map<string, Promise<void>>();
  let seq = 0;
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
          };
          coinTx.push(row);
          return row;
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
      multiplier: { findMany: async () => [] },
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

  return { db: root, users, coinTx, xpEvents, streaks, config };
}
