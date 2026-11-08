import { Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import { createPushProvider } from './push-provider.factory.js';
import { DevPushProvider, type PushProvider } from './push.provider.js';
import { PushService, localWeekStart } from './push.service.js';

// @nestjs/schedule ships ESM-only; this jest config doesn't transform it.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_HOUR: '0 0-23/1 * * *' },
}));

interface LogRow {
  id: string;
  userId: string;
  channel: string;
  kind: string;
  payload: unknown;
  sentAt: Date | null;
  scheduledFor: Date | null;
}

/** In-memory Notification table (PUSH log) + analytics sink. */
function fakeLog() {
  const rows: LogRow[] = [];
  const events: { name: string; props: Record<string, unknown> }[] = [];
  let seq = 0;
  type Where = {
    id?: string;
    userId?: string;
    channel?: string;
    kind?: string | { not: string };
    sentAt?: null | { gte: Date };
  };
  const match = (r: LogRow, w: Where) =>
    (w.id === undefined || r.id === w.id) &&
    (w.userId === undefined || r.userId === w.userId) &&
    (w.channel === undefined || r.channel === w.channel) &&
    (w.kind === undefined ||
      (typeof w.kind === 'string'
        ? r.kind === w.kind
        : r.kind !== w.kind.not)) &&
    (w.sentAt === undefined ||
      (w.sentAt === null
        ? r.sentAt === null
        : r.sentAt !== null && r.sentAt >= w.sentAt.gte));
  return {
    rows,
    events,
    notification: {
      create: jest.fn(async ({ data }: { data: Partial<LogRow> }) => {
        const row = {
          sentAt: null,
          scheduledFor: null,
          ...data,
          id: `n${++seq}`,
        } as LogRow;
        rows.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<LogRow>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Where; data: Partial<LogRow> }) => {
          const hit = rows.filter((r) => match(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: Where }) => {
        const keep = rows.filter((r) => !match(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Where }) =>
          rows.find((r) => match(r, where)) ?? null,
      ),
      count: jest.fn(
        async ({ where }: { where: Where }) =>
          rows.filter((r) => match(r, where)).length,
      ),
    },
    analyticsEvent: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: { name: string; props: Record<string, unknown> };
        }) => {
          events.push({ name: data.name, props: data.props });
          return data;
        },
      ),
    },
  };
}

function setup(user: Record<string, unknown> | null, invalid: string[] = []) {
  const log = fakeLog();
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    deviceToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: invalid.length }),
    },
    notification: log.notification,
    analyticsEvent: log.analyticsEvent,
  };
  const provider: PushProvider = {
    mode: 'dev',
    send: jest.fn(async (msgs) => ({
      sent: msgs.length - invalid.length,
      failed: invalid.length,
      invalidTokens: invalid,
    })),
  };
  return {
    prisma,
    provider,
    log,
    svc: new PushService(prisma as never, provider),
  };
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
  const { prisma, provider, log } = setup(user);
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
  return { svc, provider, deferrer, redis, log, prisma };
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
        notificationId: expect.any(String),
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

describe('PushService.sendToUser — per-user rules (docs/10 §3)', () => {
  const DAY = 24 * 60 * 60_000;
  const withPrefs = (
    prefs: { kind: string; pushEnabled: boolean; fewerLevel: number }[],
    extra: Record<string, unknown> = {},
  ) => ({ ...baseUser, notificationPrefs: prefs, ...extra });

  it('skips a kind whose push is off (PROMO by default) and records push_skipped', async () => {
    const { svc, provider, log } = setupRules();
    expect(
      await svc.sendToUser('u1', msg, { now: NOON, kind: 'PROMO' }),
    ).toEqual({ status: 'disabled' });
    const off = setupRules(
      withPrefs([{ kind: 'ITEM_DROP', pushEnabled: false, fewerLevel: 0 }]),
    );
    expect(
      (await off.svc.sendToUser('u1', msg, { now: NOON, kind: 'ITEM_DROP' }))
        .status,
    ).toBe('disabled');
    expect(provider.send).not.toHaveBeenCalled();
    expect(log.events).toEqual([
      { name: 'push_skipped', props: { kind: 'PROMO', reason: 'disabled' } },
    ]);
  });

  it('SYSTEM and BILLING push can never be disabled', async () => {
    const { svc } = setupRules(
      withPrefs([
        { kind: 'SYSTEM', pushEnabled: false, fewerLevel: 2 },
        { kind: 'BILLING', pushEnabled: false, fewerLevel: 0 },
      ]),
    );
    expect(
      (await svc.sendToUser('u1', msg, { now: NOON, kind: 'BILLING' })).status,
    ).toBe('sent');
    expect(
      (await svc.sendToUser('u1', msg, { now: NOON, kind: 'SYSTEM' })).status,
    ).toBe('sent');
  });

  it('logs a PUSH row with sentAt and a push_sent event', async () => {
    const { svc, log } = setupRules();
    await svc.sendToUser('u1', msg, {
      now: NOON,
      kind: 'LEAGUE_RESULT',
      logPayload: { title: 'T', inAppId: 'i1' },
    });
    expect(log.rows).toEqual([
      expect.objectContaining({
        userId: 'u1',
        channel: 'PUSH',
        kind: 'LEAGUE_RESULT',
        payload: { title: 'T', inAppId: 'i1' },
        sentAt: NOON,
      }),
    ]);
    expect(log.events).toEqual([
      { name: 'push_sent', props: { kind: 'LEAGUE_RESULT', devices: 2 } },
    ]);
  });

  it('fewer level 1 → one push of the kind per 2 days; level 2 → per 7 days', async () => {
    for (const [level, windowDays] of [
      [1, 2],
      [2, 7],
    ] as const) {
      const { svc, redis } = setupRules(
        withPrefs([
          { kind: 'ITEM_DROP', pushEnabled: true, fewerLevel: level },
        ]),
      );
      const t0 = NOON.getTime();
      if (redis) redis.clock = () => t0;
      const send = async (ms: number, kind: 'ITEM_DROP' | 'LEAGUE_RESULT') => {
        if (redis) redis.clock = () => ms;
        return svc.sendToUser('u1', msg, { now: new Date(ms), kind });
      };
      expect((await send(t0, 'ITEM_DROP')).status).toBe('sent');
      expect(await send(t0 + DAY, 'ITEM_DROP')).toEqual({
        status: 'capped',
        reason: 'fewer',
      });
      // Other kinds are unaffected.
      expect((await send(t0 + DAY + 1, 'LEAGUE_RESULT')).status).toBe('sent');
      expect(
        (await send(t0 + (windowDays - 1) * DAY + 3600_000, 'ITEM_DROP'))
          .status,
      ).toBe('capped');
      expect((await send(t0 + windowDays * DAY + 1, 'ITEM_DROP')).status).toBe(
        'sent',
      );
    }
  });

  it('caps non-SYSTEM pushes at 14 per local ISO week unless opted in', async () => {
    const seed = (
      log: ReturnType<typeof fakeLog>,
      n: number,
      kind = 'ITEM_DROP',
    ) => {
      for (let i = 0; i < n; i++) {
        log.rows.push({
          id: `seed${kind}${i}`,
          userId: 'u1',
          channel: 'PUSH',
          kind,
          payload: {},
          sentAt: new Date(NOON.getTime() - 60 * 60_000),
          scheduledFor: null,
        });
      }
    };
    const capped = setupRules();
    seed(capped.log, 14);
    expect(
      await capped.svc.sendToUser('u1', msg, { now: NOON, kind: 'ITEM_DROP' }),
    ).toEqual({ status: 'capped', reason: 'weekly' });
    expect(capped.log.events.at(-1)).toEqual({
      name: 'push_skipped',
      props: { kind: 'ITEM_DROP', reason: 'cap' },
    });

    const systemOnly = setupRules();
    seed(systemOnly.log, 20, 'SYSTEM');
    expect(
      (
        await systemOnly.svc.sendToUser('u1', msg, {
          now: NOON,
          kind: 'ITEM_DROP',
        })
      ).status,
    ).toBe('sent');

    const optedIn = setupRules({ ...baseUser, pushWeeklyOptIn: true });
    seed(optedIn.log, 14);
    expect(
      (
        await optedIn.svc.sendToUser('u1', msg, {
          now: NOON,
          kind: 'ITEM_DROP',
        })
      ).status,
    ).toBe('sent');
  });

  it("honours the user's daily cap: 0 = none, 3 = three", async () => {
    const none = setupRules({ ...baseUser, pushDailyCap: 0 });
    expect(
      await none.svc.sendToUser('u1', msg, { now: NOON, kind: 'ITEM_DROP' }),
    ).toEqual({ status: 'capped', reason: 'daily' });
    expect(
      (await none.svc.sendToUser('u1', msg, { now: NOON, kind: 'SYSTEM' }))
        .status,
    ).toBe('sent');

    const redis = new FakeRedis();
    let now = new Date('2026-10-07T12:00:00Z').getTime();
    redis.clock = () => now;
    const three = setupRules({ ...baseUser, pushDailyCap: 3 }, { redis });
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        (await three.svc.sendToUser('u1', msg, { now: new Date(now) })).status,
      );
      now += 31 * 60_000;
    }
    expect(results).toEqual(['sent', 'sent', 'sent', 'capped']);
  });

  it('a deferred push keeps one PUSH row: scheduledFor, then sentAt on delivery', async () => {
    const { svc, log, deferrer } = setupRules();
    const res = await svc.sendToUser('u1', msg, {
      now: MIDNIGHT,
      kind: 'LEAGUE_RESULT',
    });
    expect(res.status).toBe('deferred');
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].scheduledFor).toEqual(new Date('2026-10-08T11:00:00Z'));
    const job = (deferrer?.defer as jest.Mock).mock.calls[0][0] as {
      notificationId: string;
    };
    const later = new Date('2026-10-08T11:00:00Z');
    await svc.sendToUser('u1', msg, {
      now: later,
      kind: 'LEAGUE_RESULT',
      notificationId: job.notificationId,
    });
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].sentAt).toEqual(later);
  });

  it('a deferred push that is skipped at delivery leaves no log row', async () => {
    const { svc, log, deferrer } = setupRules({ ...baseUser, pushDailyCap: 0 });
    await svc.sendToUser('u1', msg, { now: MIDNIGHT, kind: 'ITEM_DROP' });
    const job = (deferrer?.defer as jest.Mock).mock.calls[0][0] as {
      notificationId: string;
    };
    expect(
      await svc.sendToUser('u1', msg, {
        now: new Date('2026-10-08T11:00:00Z'),
        kind: 'ITEM_DROP',
        notificationId: job.notificationId,
      }),
    ).toEqual({ status: 'capped', reason: 'daily' });
    expect(log.rows).toHaveLength(0);
  });

  it('localWeekStart is Monday 00:00 user-local', () => {
    // Wed 2026-10-07 12:00 São Paulo (UTC-3) → Mon 2026-10-05 00:00 local = 03:00Z.
    expect(
      localWeekStart(NOON, { date: '2026-10-07', minutes: 12 * 60 }),
    ).toEqual(new Date('2026-10-05T03:00:00Z'));
    // A Monday is its own week start.
    const mon = new Date('2026-10-05T15:00:00Z');
    expect(
      localWeekStart(mon, { date: '2026-10-05', minutes: 12 * 60 }),
    ).toEqual(new Date('2026-10-05T03:00:00Z'));
  });
});

describe('PushService — browser web push (Phase 14)', () => {
  const sub = (n: number) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/web-${n}`,
    p256dh: `k${n}`,
    auth: `a${n}`,
  });

  function setupWeb(
    user: Record<string, unknown>,
    web: { enabled?: boolean; expired?: string[] } = {},
  ) {
    const { prisma, provider, log } = setup(user);
    const webPrisma = {
      ...prisma,
      webPushSubscription: {
        deleteMany: jest.fn(
          async ({ where }: { where: { endpoint: { in: string[] } } }) => ({
            count: where.endpoint.in.length,
          }),
        ),
      },
    };
    const webPush = {
      enabled: web.enabled ?? true,
      send: jest.fn(async (targets: { endpoint: string }[]) => ({
        sent: targets.length - (web.expired?.length ?? 0),
        failed: web.expired?.length ?? 0,
        expiredEndpoints: web.expired ?? [],
      })),
    };
    const svc = new PushService(
      webPrisma as never,
      provider,
      null,
      null,
      webPush as never,
    );
    return { svc, provider, webPush, prisma: webPrisma, log };
  }

  it('delivers the same message to native tokens and browser subscriptions', async () => {
    const { svc, provider, webPush } = setupWeb({
      ...baseUser,
      deviceTokens: [{ token: 'a' }],
      webPushSubscriptions: [sub(1), sub(2)],
    });
    const res = await svc.sendToUser(
      'u1',
      { title: 'T', body: 'B', data: { url: '/today' } },
      { now: NOON, kind: 'STREAK_REMINDER' },
    );
    expect(res).toEqual({ status: 'sent', sent: 3, failed: 0, pruned: 0 });
    expect(provider.send).toHaveBeenCalledWith([
      { token: 'a', title: 'T', body: 'B', data: { url: '/today' } },
    ]);
    expect(webPush.send).toHaveBeenCalledWith([sub(1), sub(2)], {
      title: 'T',
      body: 'B',
      data: { url: '/today' },
    });
  });

  it('a browser-only user is reachable; quiet hours still hold the push', async () => {
    const user = {
      ...baseUser,
      deviceTokens: [],
      webPushSubscriptions: [sub(1)],
    };
    const noon = setupWeb(user);
    expect(
      (
        await noon.svc.sendToUser('u1', msg, {
          now: NOON,
          kind: 'STREAK_REMINDER',
        })
      ).status,
    ).toBe('sent');
    expect(noon.provider.send).not.toHaveBeenCalled();
    expect(noon.webPush.send).toHaveBeenCalledTimes(1);

    const night = setupWeb(user);
    expect(
      await night.svc.sendToUser('u1', msg, {
        now: MIDNIGHT,
        kind: 'STREAK_REMINDER',
      }),
    ).toEqual({ status: 'quiet_hours', retryAfterMinutes: 8 * 60 });
    expect(night.webPush.send).not.toHaveBeenCalled();
  });

  it('deletes subscriptions the push service answered 404 / 410 for', async () => {
    const { svc, prisma } = setupWeb(
      { ...baseUser, deviceTokens: [], webPushSubscriptions: [sub(1), sub(2)] },
      { expired: [sub(2).endpoint] },
    );
    const res = await svc.sendToUser('u1', msg, { now: NOON });
    expect(res).toEqual({ status: 'sent', sent: 1, failed: 1, pruned: 1 });
    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: [sub(2).endpoint] } },
    });
  });

  it('ignores browser subscriptions while web push is off (no VAPID keys)', async () => {
    const { svc, webPush } = setupWeb(
      { ...baseUser, deviceTokens: [], webPushSubscriptions: [sub(1)] },
      { enabled: false },
    );
    expect((await svc.sendToUser('u1', msg, { now: NOON })).status).toBe(
      'no_devices',
    );
    expect(webPush.send).not.toHaveBeenCalled();
  });

  it('a disabled kind never reaches the browser', async () => {
    const { svc, webPush } = setupWeb({
      ...baseUser,
      deviceTokens: [],
      webPushSubscriptions: [sub(1)],
      notificationPrefs: [
        { kind: 'STREAK_REMINDER', pushEnabled: false, fewerLevel: 0 },
      ],
    });
    expect(
      (await svc.sendToUser('u1', msg, { now: NOON, kind: 'STREAK_REMINDER' }))
        .status,
    ).toBe('disabled');
    expect(webPush.send).not.toHaveBeenCalled();
  });
});
