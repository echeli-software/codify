import { Prisma } from '@prisma/client';

/**
 * Minimal in-memory stand-in for the Prisma calls the billing webhook
 * services make — used by unit tests only. `$transaction` snapshots the
 * whole store and restores it if the callback throws, i.e. it has real
 * rollback semantics, which is what the idempotency-on-failure tests need.
 */

type Row = Record<string, unknown> & { id: string };

export interface FakeState {
  idempotency: Map<string, { key: string; scope: string }>;
  subscriptions: Row[];
  users: Row[];
  plans: Row[];
  planPrices: Row[];
}

type Where = Record<string, unknown>;

function matches(row: Row, where: Where, state: FakeState): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'plan' && cond && typeof cond === 'object') {
      const plan = state.plans.find((p) => p.id === row['planId']);
      return !!plan && matches(plan, cond as Where, state);
    }
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; gt?: Date };
      if (c.in) return c.in.includes(v);
      if ('not' in c) return v !== c.not;
      if (c.gt) return v instanceof Date && v.getTime() > c.gt.getTime();
    }
    if (cond === null) return v == null;
    return v === cond;
  });
}

let seq = 0;

export class FakeBillingPrisma {
  state: FakeState = {
    idempotency: new Map(),
    subscriptions: [],
    users: [],
    plans: [],
    planPrices: [],
  };
  /** Optional failure injection, e.g. to make the next subscription write throw. */
  failNext: { op: string; error: Error } | null = null;
  transactions = 0;

  private maybeFail(op: string): void {
    if (this.failNext && this.failNext.op === op) {
      const err = this.failNext.error;
      this.failNext = null;
      throw err;
    }
  }

  readonly idempotencyRecord = {
    findUnique: async ({ where }: { where: { key: string } }) =>
      this.state.idempotency.get(where.key) ?? null,
    create: async ({ data }: { data: { key: string; scope: string } }) => {
      if (this.state.idempotency.has(data.key)) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on key',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        );
      }
      this.state.idempotency.set(data.key, { ...data });
      return data;
    },
  };

  readonly user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.state.users.find((u) => u.id === where.id) ?? null,
  };

  readonly plan = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.state.plans.find((p) => p.id === where.id) ?? null,
    findFirst: async ({ where }: { where: Where }) =>
      this.state.plans.find((p) => matches(p, where, this.state)) ?? null,
  };

  readonly planPrice = {
    findFirst: async ({ where }: { where: Where }) =>
      this.state.planPrices.find((p) => matches(p, where, this.state)) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) => {
      const price = this.state.planPrices.find((p) => p.id === where.id);
      if (!price) return null;
      const plan = this.state.plans.find((p) => p.id === price['planId']);
      return { ...price, plan: { deletedAt: plan?.['deletedAt'] ?? null } };
    },
  };

  readonly subscription = {
    findUnique: async ({ where }: { where: Where }) =>
      this.state.subscriptions.find((s) => matches(s, where, this.state)) ??
      null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.maybeFail('subscription.create');
      for (const k of ['stripeSubscriptionId', 'storeTransactionId']) {
        if (data[k] && this.state.subscriptions.some((s) => s[k] === data[k])) {
          throw new Prisma.PrismaClientKnownRequestError(
            `Unique constraint failed on ${k}`,
            {
              code: 'P2002',
              clientVersion: 'test',
            },
          );
        }
      }
      const now = new Date();
      const row: Row = {
        id: `sub-row-${++seq}`,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
        pastDueSince: null,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        storeTransactionId: null,
        storeProductId: null,
        revenueCatUserId: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.state.subscriptions.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: Where;
      data: Record<string, unknown>;
    }) => {
      this.maybeFail('subscription.update');
      const row = this.state.subscriptions.find((s) =>
        matches(s, where, this.state),
      );
      if (!row) throw new Error('Record to update not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: Where;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const row = this.state.subscriptions.find((s) =>
        matches(s, where, this.state),
      );
      if (row)
        return this.subscription.update({
          where: { id: row.id },
          data: update,
        });
      return this.subscription.create({ data: create });
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const snapshot = structuredClone(this.state);
    try {
      return await fn(this);
    } catch (err) {
      this.state = snapshot;
      throw err;
    }
  }
}
