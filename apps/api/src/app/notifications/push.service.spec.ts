import { Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import { createPushProvider } from './push-provider.factory.js';
import { DevPushProvider, type PushProvider } from './push.provider.js';
import { PushService } from './push.service.js';

// @nestjs/schedule ships ESM-only; this jest config doesn't transform it.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_HOUR: '0 0-23/1 * * *' },
}));

function setup(user: Record<string, unknown> | null, invalid: string[] = []) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    deviceToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: invalid.length }),
    },
  };
  const provider: PushProvider = {
    mode: 'dev',
    send: jest.fn(async (msgs) => ({
      sent: msgs.length - invalid.length,
      failed: invalid.length,
      invalidTokens: invalid,
    })),
  };
  return { prisma, provider, svc: new PushService(prisma as never, provider) };
}

const baseUser = {
  timezone: 'America/Sao_Paulo',
  quietHoursStart: null,
  quietHoursEnd: null,
  deletedAt: null,
  deviceTokens: [{ token: 'a' }, { token: 'b' }],
};
// 15:00 UTC = 12:00 São Paulo (outside default quiet hours); 03:00 UTC = 00:00 (inside).
const NOON = new Date('2026-10-07T15:00:00Z');
const MIDNIGHT = new Date('2026-10-08T03:00:00Z');
const msg = { title: 'T', body: 'B', data: { type: 'x' } };

describe('PushService.sendToUser', () => {
  it('fans out to every device and prunes invalid tokens', async () => {
    const { svc, provider, prisma } = setup(baseUser, ['b']);
    const res = await svc.sendToUser('u1', msg, { now: NOON });
    expect(res).toEqual({ status: 'sent', sent: 1, failed: 1, pruned: 1 });
    expect(provider.send).toHaveBeenCalledWith([
      { token: 'a', ...msg },
      { token: 'b', ...msg },
    ]);
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['b'] } },
    });
  });

  it('holds pushes during default quiet hours and says when they end', async () => {
    const { svc, provider } = setup(baseUser);
    const res = await svc.sendToUser('u1', msg, { now: MIDNIGHT });
    expect(res).toEqual({ status: 'quiet_hours', retryAfterMinutes: 8 * 60 });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('respects custom quiet hours', async () => {
    const { svc } = setup({
      ...baseUser,
      quietHoursStart: 11 * 60,
      quietHoursEnd: 13 * 60,
    });
    expect((await svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'quiet_hours',
    );
  });

  it('can bypass quiet hours (SYSTEM pushes)', async () => {
    const { svc } = setup(baseUser);
    expect(
      (
        await svc.sendToUser('u1', msg, {
          now: MIDNIGHT,
          respectQuietHours: false,
        })
      ).status,
    ).toBe('sent');
  });

  it('reports missing users / devices', async () => {
    expect((await setup(null).svc.sendToUser('u1', msg)).status).toBe(
      'user_not_found',
    );
    expect(
      (
        await setup({ ...baseUser, deletedAt: new Date() }).svc.sendToUser(
          'u1',
          msg,
        )
      ).status,
    ).toBe('user_not_found');
    expect(
      (
        await setup({ ...baseUser, deviceTokens: [] }).svc.sendToUser(
          'u1',
          msg,
          { now: NOON },
        )
      ).status,
    ).toBe('no_devices');
  });
});

describe('createPushProvider', () => {
  it('uses the dev provider without FCM credentials outside production', () => {
    const cfg = new AppConfigService(
      parseEnv({ DATABASE_URL: 'postgres://x' }),
    );
    expect(createPushProvider(cfg)).toBeInstanceOf(DevPushProvider);
  });

  it('refuses to boot in production without FCM credentials', () => {
    const cfg = new AppConfigService({
      ...parseEnv({ DATABASE_URL: 'postgres://x' }),
      NODE_ENV: 'production',
    });
    expect(() => createPushProvider(cfg)).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );
  });
});

/** In-memory stand-in for the ioredis calls PushCapStore makes. */
class FakeRedis {
  status = 'ready';
  store = new Map<string, { value: string; expiresAt: number | null }>();
  clock = () => Date.now();
  failing = false;

  private live(key: string) {
    const e = this.store.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= this.clock()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }
  private guard() {
    if (this.failing) throw new Error('ECONNREFUSED');
  }
  async incr(key: string) {
    this.guard();
    const e = this.live(key);
    const n = Number(e?.value ?? 0) + 1;
    this.store.set(key, { value: String(n), expiresAt: e?.expiresAt ?? null });
    return n;
  }
  async decr(key: string) {
    this.guard();
    const e = this.live(key);
    const n = Number(e?.value ?? 0) - 1;
    this.store.set(key, { value: String(n), expiresAt: e?.expiresAt ?? null });
    return n;
  }
  async pexpire(key: string, ms: number) {
    const e = this.live(key);
    if (e) e.expiresAt = this.clock() + ms;
    return e ? 1 : 0;
  }
  async set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX') {
    this.guard();
    expect([mode, nx]).toEqual(['PX', 'NX']);
    if (this.live(key)) return null;
    this.store.set(key, { value, expiresAt: this.clock() + ms });
    return 'OK';
  }
  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
}

function setupRules(
  user: Record<string, unknown> = baseUser,
  opts: { redis?: FakeRedis | null; deferOk?: boolean | null } = {},
) {
  const { prisma, provider } = setup(user);
  const deferrer =
    opts.deferOk === null
      ? null
      : { defer: jest.fn(async () => opts.deferOk ?? true) };
  const redis = opts.redis === undefined ? new FakeRedis() : opts.redis;
  const svc = new PushService(
    prisma as never,
    provider,
    deferrer,
    redis as never,
  );
  return { svc, provider, deferrer, redis };
}

describe('PushService.sendToUser — quiet-hours deferral (docs/10 §3)', () => {
  it('defers a push inside quiet hours to the window end on the queue', async () => {
    const { svc, deferrer, provider } = setupRules();
    // 00:00:30 São Paulo → quiet until 08:00 local = 11:00Z.
    const at = new Date('2026-10-08T03:00:30Z');
    const res = await svc.sendToUser(
      'u1',
      ({ locale }) => ({ title: `T-${locale}`, body: 'B' }),
      { now: at, kind: 'LEAGUE_RESULT' },
    );
    expect(res).toEqual({
      status: 'deferred',
      deliverAt: '2026-10-08T11:00:00.000Z',
    });
    expect(deferrer?.defer).toHaveBeenCalledWith(
      {
        userId: 'u1',
        kind: 'LEAGUE_RESULT',
        message: { title: 'T-pt-BR', body: 'B' },
        deliverAt: '2026-10-08T11:00:00.000Z',
      },
      new Date('2026-10-08T11:00:00.000Z'),
    );
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('keeps the quiet_hours result when the queue is unreachable or absent (dev)', async () => {
    for (const deferOk of [false, null]) {
      const { svc } = setupRules(baseUser, { deferOk });
      expect(await svc.sendToUser('u1', msg, { now: MIDNIGHT })).toEqual({
        status: 'quiet_hours',
        retryAfterMinutes: 8 * 60,
      });
    }
  });

  it('SYSTEM bypasses quiet hours (and is never deferred)', async () => {
    const { svc, deferrer } = setupRules();
    const res = await svc.sendToUser('u1', msg, {
      now: MIDNIGHT,
      kind: 'SYSTEM',
      respectQuietHours: false,
    });
    expect(res.status).toBe('sent');
    expect(deferrer?.defer).not.toHaveBeenCalled();
  });
});

describe('PushService.sendToUser — caps (docs/10 §3)', () => {
  const at = (iso: string) => ({ now: new Date(iso) });

  it('allows 2 pushes per local day, 30+ minutes apart, then caps', async () => {
    const redis = new FakeRedis();
    let now = new Date('2026-10-07T13:00:00Z').getTime(); // 10:00 São Paulo
    redis.clock = () => now;
    const { svc, provider } = setupRules(baseUser, { redis });

    expect(
      (await svc.sendToUser('u1', msg, at('2026-10-07T13:00:00Z'))).status,
    ).toBe('sent');

    now += 10 * 60_000;
    expect(await svc.sendToUser('u1', msg, at('2026-10-07T13:10:00Z'))).toEqual(
      {
        status: 'capped',
        reason: 'spacing',
      },
    );

    now += 25 * 60_000;
    expect(
      (await svc.sendToUser('u1', msg, at('2026-10-07T13:35:00Z'))).status,
    ).toBe('sent');

    now += 60 * 60_000;
    expect(await svc.sendToUser('u1', msg, at('2026-10-07T14:35:00Z'))).toEqual(
      {
        status: 'capped',
        reason: 'daily',
      },
    );
    expect(provider.send).toHaveBeenCalledTimes(2);

    // Next local day (São Paulo) → a fresh budget.
    now = new Date('2026-10-08T13:00:00Z').getTime();
    expect(
      (await svc.sendToUser('u1', msg, at('2026-10-08T13:00:00Z'))).status,
    ).toBe('sent');
  });

  it('caps apply even with respectQuietHours:false; SYSTEM bypasses them', async () => {
    const { svc } = setupRules();
    await svc.sendToUser('u1', msg, { now: NOON });
    expect(
      await svc.sendToUser('u1', msg, { now: NOON, respectQuietHours: false }),
    ).toEqual({ status: 'capped', reason: 'spacing' });
    expect(
      (await svc.sendToUser('u1', msg, { now: NOON, kind: 'SYSTEM' })).status,
    ).toBe('sent');
  });

  it('a push that reaches no device gives its slot back', async () => {
    const { svc, provider } = setupRules();
    (provider.send as jest.Mock).mockResolvedValueOnce({
      sent: 0,
      failed: 2,
      invalidTokens: [],
    });
    await svc.sendToUser('u1', msg, { now: NOON });
    expect((await svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'sent',
    );
  });

  it('allows (with a warning) when Redis is down or unset', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const down = new FakeRedis();
    down.failing = true;
    const a = setupRules(baseUser, { redis: down });
    expect((await a.svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'sent',
    );
    expect((await a.svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'sent',
    );

    const notReady = new FakeRedis();
    notReady.status = 'reconnecting';
    const b = setupRules(baseUser, { redis: notReady });
    expect((await b.svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'sent',
    );

    const c = setupRules(baseUser, { redis: null });
    expect((await c.svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'sent',
    );
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /push caps not enforced/,
    );
    warn.mockRestore();
  });

  it('tryReserveCap shares the same budget (batch jobs)', async () => {
    const { svc } = setupRules();
    expect(await svc.tryReserveCap('u1', 'America/Sao_Paulo', NOON)).toBe(true);
    expect(await svc.tryReserveCap('u1', 'America/Sao_Paulo', NOON)).toBe(
      false,
    );
    expect(await svc.sendToUser('u1', msg, { now: NOON })).toEqual({
      status: 'capped',
      reason: 'spacing',
    });
  });
});
