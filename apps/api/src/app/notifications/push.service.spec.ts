import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import { createPushProvider } from './notifications.module.js';
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
