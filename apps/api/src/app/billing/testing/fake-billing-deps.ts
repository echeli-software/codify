import { BadRequestException } from '@nestjs/common';
import { coinKey } from '../../gamification/gamification.service.js';
import {
  GAMIFICATION_CONFIG_DEFAULTS,
  type GamificationConfigKey,
  type GamificationConfigValues,
} from '../../gamification/gamification-config.service.js';
import type { BillingProvider } from '../billing.provider.js';
import { WebhookService } from '../webhook.service.js';
import {
  INLINE_WEBHOOK_ENQUEUER,
  type WebhookEnqueuer,
} from '../webhook-queue.js';
import type { FakeBillingPrisma } from './fake-billing-prisma.js';

/** A recording function (this file is compiled with the app — no jest globals). */
export type Spy<A extends unknown[], R> = ((...args: A) => R) & { calls: A[] };

export function spy<A extends unknown[], R>(
  impl: (...args: A) => R,
): Spy<A, R> {
  const f = ((...args: A) => {
    f.calls.push(args);
    return impl(...args);
  }) as Spy<A, R>;
  f.calls = [];
  return f;
}

/**
 * Test doubles for WebhookService's collaborators. The fake gamification
 * writes coin-ledger rows into the fake Prisma state, so they roll back with
 * a failed transaction exactly like the real ledger would.
 */
export function fakeGamification(prisma: FakeBillingPrisma) {
  const userRow = (id: string) => {
    const u = prisma.state.users.find((x) => x.id === id);
    if (!u) throw new Error(`no user ${id}`);
    return u as { id: string; coins?: number };
  };
  return {
    alreadyGranted: spy(async (_tx: unknown, key: string) =>
      prisma.state.coinTransactions.some(
        (c) => c['idempotencyKey'] === coinKey(key),
      ),
    ),
    grantReward: spy(
      async (
        p: {
          userId: string;
          baseCoins: number;
          coinSource: string;
          idempotencyKey?: string | null;
        },
        tx?: unknown,
      ) => {
        void tx; // recorded by the spy (the webhook passes its transaction)
        const u = userRow(p.userId);
        u.coins = (u.coins ?? 0) + p.baseCoins;
        prisma.state.coinTransactions.push({
          id: `ct-${prisma.state.coinTransactions.length + 1}`,
          userId: p.userId,
          delta: p.baseCoins,
          source: p.coinSource,
          idempotencyKey: p.idempotencyKey ? coinKey(p.idempotencyKey) : null,
          createdAt: prisma.clock ?? new Date(),
        });
        return {};
      },
    ),
    spendCoins: spy(
      async (p: {
        userId: string;
        amount: number;
        source: string;
        idempotencyKey?: string | null;
        capAtBalance?: boolean;
      }) => {
        const u = userRow(p.userId);
        const balance = u.coins ?? 0;
        const amount = p.capAtBalance
          ? Math.min(p.amount, Math.max(balance, 0))
          : p.amount;
        if (balance < amount)
          throw new BadRequestException('Insufficient coins');
        u.coins = balance - amount;
        if (amount > 0) {
          prisma.state.coinTransactions.push({
            id: `ct-${prisma.state.coinTransactions.length + 1}`,
            userId: p.userId,
            delta: -amount,
            source: p.source,
            idempotencyKey: p.idempotencyKey ?? null,
            createdAt: prisma.clock ?? new Date(),
          });
        }
        return { coins: u.coins, spent: amount };
      },
    ),
  };
}

export function fakeConfig(overrides: Partial<GamificationConfigValues> = {}) {
  const values: Partial<GamificationConfigValues> = { ...overrides };
  return {
    values,
    get: spy(
      async <K extends GamificationConfigKey>(key: K) =>
        (values[key] ??
          GAMIFICATION_CONFIG_DEFAULTS[key]) as GamificationConfigValues[K],
    ),
  };
}

export interface FakePushResult {
  status: string;
  [k: string]: unknown;
}

export function fakePush() {
  const state: { result: FakePushResult } = {
    result: { status: 'sent', sent: 1, failed: 0, pruned: 0 },
  };
  return {
    /** Result the next sends resolve to. */
    get result(): FakePushResult {
      return state.result;
    },
    set result(r: FakePushResult) {
      state.result = r;
    },
    sendToUser: spy(
      async (
        ...args: [userId: string, content: unknown, opts?: unknown]
      ): Promise<FakePushResult> => {
        void args; // recorded by the spy
        return state.result;
      },
    ),
  };
}

export function makeWebhookService(
  prisma: FakeBillingPrisma,
  provider: BillingProvider,
  opts: {
    enqueuer?: WebhookEnqueuer;
    config?: Partial<GamificationConfigValues>;
  } = {},
) {
  const gamification = fakeGamification(prisma);
  const config = fakeConfig(opts.config);
  const push = fakePush();
  const svc = new WebhookService(
    prisma as never,
    provider,
    opts.enqueuer ?? INLINE_WEBHOOK_ENQUEUER,
    gamification as never,
    config as never,
    push as never,
  );
  return { svc, gamification, config, push };
}
