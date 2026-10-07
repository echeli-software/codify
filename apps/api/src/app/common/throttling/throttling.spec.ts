import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import {
  AiThrottle,
  CodeThrottle,
  NoThrottle,
  RewardThrottle,
  throttleGroupsOf,
} from './throttle.decorators.js';
import { THROTTLERS } from './throttler.config.js';
import { ipTracker, userOrIpTracker } from './trackers.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

class Ctl {
  @RewardThrottle() reward() {
    return 1;
  }
  @AiThrottle() ai() {
    return 1;
  }
  @CodeThrottle() code() {
    return 1;
  }
  @NoThrottle() health() {
    return 1;
  }
  plain() {
    return 1;
  }
}

function ctx(
  handler: keyof Ctl,
  req: Record<string, unknown> = {},
  res: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getHandler: () => Ctl.prototype[handler],
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('throttle groups', () => {
  it('tags handlers with their group', () => {
    expect(throttleGroupsOf(ctx('reward'))).toEqual(['reward']);
    expect(throttleGroupsOf(ctx('ai'))).toEqual(['ai']);
    expect(throttleGroupsOf(ctx('code'))).toEqual(['code']);
    expect(throttleGroupsOf(ctx('plain'))).toEqual([]);
  });

  it('applies opt-in throttlers only to their group; default + ip apply everywhere', () => {
    const active = (h: keyof Ctl) =>
      THROTTLERS.filter((t) => !t.skipIf?.(ctx(h))).map((t) => t.name);
    expect(active('plain')).toEqual(['default', 'ip']);
    expect(active('reward')).toEqual(['default', 'ip', 'reward']);
    expect(active('ai')).toEqual(['default', 'ip', 'ai-minute', 'ai-day']);
    expect(active('code')).toEqual(['default', 'ip', 'code-burst', 'code-day']);
  });

  it('matches the docs/14 §7 limits', () => {
    const byName = Object.fromEntries(THROTTLERS.map((t) => [t.name, t]));
    expect(byName['default']).toMatchObject({ ttl: 60_000, limit: 60 });
    expect(byName['ip']).toMatchObject({ ttl: 60_000, limit: 600 });
    expect(byName['reward']).toMatchObject({ ttl: 60_000, limit: 10 });
    expect(byName['ai-minute']).toMatchObject({ ttl: 60_000, limit: 5 });
    expect(byName['ai-day']).toMatchObject({ ttl: 86_400_000, limit: 60 });
    expect(byName['code-burst']).toMatchObject({ ttl: 3_000, limit: 1 });
    expect(byName['code-day']).toMatchObject({ ttl: 86_400_000, limit: 200 });
  });
});

describe('trackers', () => {
  it('keys on the user id when authenticated, else the IP', () => {
    expect(userOrIpTracker({ ip: '1.2.3.4', user: { userId: 'u1' } })).toBe(
      'user:u1',
    );
    expect(userOrIpTracker({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(ipTracker({ ip: '1.2.3.4', user: { userId: 'u1' } })).toBe(
      'ip:1.2.3.4',
    );
  });
});

describe('UserThrottlerGuard', () => {
  function guard(limitOverrides: Partial<Record<string, number>> = {}) {
    const throttlers = THROTTLERS.map((t) => ({
      ...t,
      limit: limitOverrides[t.name!] ?? t.limit,
    }));
    const g = new UserThrottlerGuard(
      { throttlers },
      new ThrottlerStorageService(),
      new Reflector(),
    );
    return g;
  }

  it('shares the reward bucket per user across routes and sends Retry-After on 429', async () => {
    const g = guard();
    await g.onModuleInit();
    const headers: Record<string, unknown> = {};
    const res = { header: (k: string, v: unknown) => (headers[k] = v) };
    const req = { ip: '9.9.9.9', user: { userId: 'u-reward' }, headers: {} };
    for (let i = 0; i < 10; i++)
      await expect(g.canActivate(ctx('reward', req, res))).resolves.toBe(true);
    await expect(g.canActivate(ctx('reward', req, res))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);

    // A different user is unaffected; a plain route for the same user too.
    const other = { ip: '9.9.9.9', user: { userId: 'u-other' }, headers: {} };
    await expect(g.canActivate(ctx('reward', other, res))).resolves.toBe(true);
    await expect(g.canActivate(ctx('plain', req, res))).resolves.toBe(true);
  });

  it('can be switched off outside production with THROTTLE_ENABLED=false', async () => {
    const g = guard({ default: 0, ip: 0 });
    await g.onModuleInit();
    const req = { ip: '7.7.7.7', headers: {} };
    process.env['THROTTLE_ENABLED'] = 'false';
    try {
      await expect(
        g.canActivate(ctx('plain', req, { header: () => undefined })),
      ).resolves.toBe(true);
    } finally {
      delete process.env['THROTTLE_ENABLED'];
    }
    await expect(
      g.canActivate(ctx('plain', req, { header: () => undefined })),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('skips every throttler on @NoThrottle routes', async () => {
    const g = guard({ default: 0, ip: 0 });
    await g.onModuleInit();
    const req = { ip: '8.8.8.8', headers: {} };
    await expect(
      g.canActivate(ctx('health', req, { header: () => undefined })),
    ).resolves.toBe(true);
  });
});

describe('RedisThrottlerStorage', () => {
  it('maps the Lua result (ms) to a throttler record (s)', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([3, 59_500, 0, 0]) };
    const storage = new RedisThrottlerStorage(redis as never);
    const rec = await storage.increment('k', 60_000, 10, 60_000, 'default');
    expect(rec).toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      2,
      'codify:k',
      'codify:k:blocked',
      '60000',
      '10',
      '60000',
    );
  });

  it('reports blocked state with the block TTL', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([11, 30_000, 1, 45_001]),
    };
    const rec = await new RedisThrottlerStorage(redis as never).increment(
      'k',
      60_000,
      10,
      60_000,
      'reward',
    );
    expect(rec.isBlocked).toBe(true);
    expect(rec.timeToBlockExpire).toBe(46);
  });

  it('skips Redis while the client is not ready (circuit breaker)', async () => {
    const redis = { status: 'reconnecting', eval: jest.fn() };
    const storage = new RedisThrottlerStorage(redis as never);
    const rec = await storage.increment('k', 60_000, 5, 60_000, 'default');
    expect(rec.totalHits).toBe(1);
    expect(redis.eval).not.toHaveBeenCalled();
    storage.onApplicationShutdown();
  });

  it('falls back to in-memory buckets when Redis fails', async () => {
    const redis = {
      eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const storage = new RedisThrottlerStorage(redis as never);
    const first = await storage.increment('k', 60_000, 1, 60_000, 'default');
    const second = await storage.increment('k', 60_000, 1, 60_000, 'default');
    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(true);
    storage.onApplicationShutdown();
  });
});
