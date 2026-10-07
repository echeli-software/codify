import { BadRequestException } from '@nestjs/common';
import {
  GAMIFICATION_CONFIG_DEFAULTS,
  GamificationConfigService,
  validateConfigValue,
} from './gamification-config.service.js';

function makePrisma(initial: Record<string, unknown> = {}) {
  const rows = new Map(Object.entries(initial));
  const prisma = {
    gamificationConfig: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows.has(where.key)
          ? {
              key: where.key,
              value: rows.get(where.key),
              updatedAt: new Date(),
            }
          : null,
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in
          .filter((k) => rows.has(k))
          .map((k) => ({ key: k, value: rows.get(k), updatedAt: new Date(0) })),
      upsert: ({
        where,
        create,
      }: {
        where: { key: string };
        create: { value: unknown };
      }) => {
        rows.set(where.key, create.value);
        return Promise.resolve();
      },
      deleteMany: ({ where }: { where: { key: string } }) => {
        rows.delete(where.key);
        return Promise.resolve();
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, rows };
}

describe('validateConfigValue', () => {
  it('accepts defaults for every key', () => {
    for (const [k, v] of Object.entries(GAMIFICATION_CONFIG_DEFAULTS)) {
      expect(validateConfigValue(k as never, v)).toBeNull();
    }
  });
  it('rejects out-of-range or malformed values', () => {
    expect(validateConfigValue('multiplier.cap', 0)).not.toBeNull();
    expect(validateConfigValue('multiplier.cap', '30')).not.toBeNull();
    expect(validateConfigValue('billing.pastDueGraceDays', 2.5)).not.toBeNull();
    expect(validateConfigValue('quest.dailyCount', 0)).not.toBeNull();
    expect(
      validateConfigValue('streak.milestones', { '0': { xp: 1, coins: 1 } }),
    ).not.toBeNull();
    expect(
      validateConfigValue('streak.milestones', { '7': { xp: -1, coins: 1 } }),
    ).not.toBeNull();
    expect(
      validateConfigValue('league.promotionReward', { xp: 1, coins: 1 }),
    ).not.toBeNull();
    expect(
      validateConfigValue('league.rank1Reward', { xp: 1, coins: 1, extra: 1 }),
    ).not.toBeNull();
  });
});

describe('GamificationConfigService', () => {
  it('falls back to the default when a row is missing or invalid', async () => {
    const { prisma } = makePrisma({ 'multiplier.cap': 'nonsense' });
    const svc = new GamificationConfigService(prisma as never);
    expect(await svc.get('multiplier.cap')).toBe(30);
    expect(await svc.get('quest.dailyCount')).toBe(3);
  });

  it('lists every known key with value, default and isDefault', async () => {
    const { prisma } = makePrisma({ 'quest.dailyCount': 4 });
    const svc = new GamificationConfigService(prisma as never);
    const list = await svc.list();
    expect(list.map((e) => e.key)).toEqual(
      Object.keys(GAMIFICATION_CONFIG_DEFAULTS),
    );
    const q = list.find((e) => e.key === 'quest.dailyCount')!;
    expect(q.value).toBe(4);
    expect(q.isDefault).toBe(false);
    expect(list.find((e) => e.key === 'multiplier.cap')!.isDefault).toBe(true);
  });

  it('updates valid keys, resets with null, returns the before values', async () => {
    const { prisma, rows } = makePrisma({ 'streak.freezeCap': 3 });
    const svc = new GamificationConfigService(prisma as never);
    const res = await svc.update({
      'multiplier.cap': 12.5,
      'streak.freezeCap': null,
    });
    expect(rows.get('multiplier.cap')).toBe(12.5);
    expect(rows.has('streak.freezeCap')).toBe(false);
    expect(res.before).toEqual({
      'multiplier.cap': null,
      'streak.freezeCap': 3,
    });
  });

  it('rejects unknown keys and invalid values atomically', async () => {
    const { prisma, rows } = makePrisma();
    const svc = new GamificationConfigService(prisma as never);
    await expect(
      svc.update({ 'multiplier.cap': 10, 'no.such.key': 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update({ 'multiplier.cap': -1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows.size).toBe(0);
  });
});
