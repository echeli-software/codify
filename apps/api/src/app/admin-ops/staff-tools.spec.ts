import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import { ExerciseHealthService } from './exercise-health.service.js';
import {
  SUPPORT_MAX_COINS_PER_GRANT,
  StaffGrantsService,
  grantLimitsFromEnv,
} from './staff-grants.service.js';
import {
  SystemNoticesService,
  TERMS_BATCH_SIZE,
  termsUpdateCopy,
} from './system-notices.service.js';

const staff = (role: ApiUser['role'], userId = `${role}-1`): ApiUser => ({
  userId,
  role,
  clerkId: 'c',
  email: 'x@y.z',
  displayName: role,
});

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

// ─── Grants ──────────────────────────────────────────────────────────────

function grantsCtx(usedToday = { coins: 0, xp: 0 }) {
  const user = { coins: 10, totalXp: 100 };
  const audits: Record<string, unknown>[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [usedToday]),
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ ...user })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    ...tx,
    user: {
      ...tx.user,
      findFirst: jest.fn(async () => ({ id: 'target' })),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const gamification = {
    grantReward: jest.fn(async (p: { baseCoins: number; baseXp: number }) => {
      user.coins += p.baseCoins;
      user.totalXp += p.baseXp;
      return {};
    }),
  };
  const svc = new StaffGrantsService(prisma as never, gamification as never);
  return { svc, gamification, audits, tx };
}

const meta = { ip: '1.2.3.4', userAgent: 'jest' };

describe('StaffGrantsService', () => {
  it('writes an ADMIN_GRANT ledger entry and an audited before/after', async () => {
    const ctx = grantsCtx();
    const res = await ctx.svc.grant(
      staff('SUPPORT'),
      'target',
      { coins: 500, reason: 'Lost streak bug' },
      meta,
    );
    expect(ctx.gamification.grantReward).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'target',
        baseCoins: 500,
        baseXp: 0,
        coinSource: 'ADMIN_GRANT',
        xpSource: 'ADMIN_GRANT',
        flat: true,
      }),
      ctx.tx,
    );
    expect(res).toMatchObject({
      coins: 500,
      before: { coins: 10 },
      after: { coins: 510 },
      remainingToday: { coins: 2500, xp: 0 },
    });
    expect(ctx.audits[0]).toMatchObject({
      action: 'user.coins_granted',
      actorRole: 'SUPPORT',
      entityId: 'target',
      ip: '1.2.3.4',
      diff: expect.objectContaining({
        coins: 500,
        reason: 'Lost streak bug',
        before: { coins: 10, totalXp: 100 },
        after: { coins: 510, totalXp: 100 },
      }),
    });
    // The per-actor lock is taken before the limit is read.
    expect(ctx.tx.$executeRaw).toHaveBeenCalled();
  });

  it('SUPPORT: ≤ 1,000 coins per grant, no XP, and the daily limit', async () => {
    const ctx = grantsCtx({ coins: 2800, xp: 0 });
    await expect(
      ctx.svc.grant(
        staff('SUPPORT'),
        't',
        { coins: SUPPORT_MAX_COINS_PER_GRANT + 1, reason: 'abc' },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'GRANT_CAP_EXCEEDED' } });
    await expect(
      ctx.svc.grant(staff('SUPPORT'), 't', { xp: 10, reason: 'abc' }, meta),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_ROLE' } });
    await expect(
      ctx.svc.grant(staff('SUPPORT'), 't', { coins: 300, reason: 'abc' }, meta),
    ).rejects.toMatchObject({ response: { code: 'GRANT_DAILY_LIMIT' } });
    expect(ctx.gamification.grantReward).not.toHaveBeenCalled();
  });

  it('ADMIN may grant XP and large amounts; empty grants are refused', async () => {
    const ctx = grantsCtx();
    const res = await ctx.svc.grant(
      staff('ADMIN'),
      't',
      { coins: 5000, xp: 200, reason: 'contest prize' },
      meta,
    );
    expect(res.after).toEqual({ coins: 5010, totalXp: 300 });
    await expect(
      ctx.svc.grant(staff('ADMIN'), 't', { reason: 'nothing' }, meta),
    ).rejects.toMatchObject({ response: { code: 'GRANT_EMPTY' } });
  });

  it('limits come from the environment', () => {
    expect(grantLimitsFromEnv({})).toEqual({
      supportDailyCoins: 3000,
      adminDailyCoins: 50000,
      adminDailyXp: 50000,
    });
    expect(
      grantLimitsFromEnv({ GRANT_DAILY_COIN_LIMIT_SUPPORT: '1500' })
        .supportDailyCoins,
    ).toBe(1500);
  });
});

// ─── Terms update (SYSTEM) ───────────────────────────────────────────────

describe('SystemNoticesService', () => {
  function ctx(userCount: number, alreadyNotified: string[] = []) {
    const ids = Array.from(
      { length: userCount },
      (_, i) => `u${String(i).padStart(4, '0')}`,
    );
    const claimed = new Set(alreadyNotified);
    const prisma = {
      user: {
        count: jest.fn(async () => ids.length),
        findMany: jest.fn(
          async ({
            where,
            take,
          }: {
            where: { id?: { gt: string } };
            take: number;
          }) =>
            ids
              .filter((id) => !where.id || id > where.id.gt)
              .slice(0, take)
              .map((id) => ({ id })),
        ),
      },
      idempotencyRecord: {
        count: jest.fn(async () => claimed.size),
        create: jest.fn(async ({ data }: { data: { key: string } }) => {
          if (claimed.has(data.key))
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 't',
            });
          claimed.add(data.key);
          return data;
        }),
      },
    };
    const notify = jest.fn(async () => ({ status: 'ok' }));
    const svc = new SystemNoticesService(prisma as never, { notify } as never);
    return { svc, notify, prisma };
  }

  it('notifies every active account once, in batches, and resumes without repeats', async () => {
    const c = ctx(TERMS_BATCH_SIZE + 5, ['system_terms_notice:v2:u0000']);
    expect(await c.svc.run('v2', '2026-12-01')).toBe(TERMS_BATCH_SIZE + 4);
    expect(c.notify).toHaveBeenCalledTimes(TERMS_BATCH_SIZE + 4);
    expect(c.prisma.user.findMany).toHaveBeenCalledTimes(2);
    const where = (
      c.prisma.user.findMany.mock.calls[0] as unknown as [{ where: object }]
    )[0].where;
    expect(where).toMatchObject({
      deletedAt: null,
      suspendedAt: null,
      purgedAt: null,
    });
    const content = (
      c.notify.mock.calls[0] as unknown as [
        string,
        (u: { locale: string }) => { kind: string; deepLink: string },
      ]
    )[1];
    expect(content({ locale: 'en-US' })).toMatchObject({
      kind: 'SYSTEM',
      deepLink: '/terms',
    });
    // Rerun: nobody gets it twice.
    expect(await c.svc.run('v2', null)).toBe(0);
  });

  it('copy names the effective date per locale', () => {
    expect(termsUpdateCopy('pt-BR', '2026-12-01').body).toContain(
      '1 de dezembro de 2026',
    );
    expect(termsUpdateCopy('en-US', null).title).toBe(
      'We updated our Terms of Use',
    );
  });

  it('refuses a second concurrent run of the same version', async () => {
    const c = ctx(3);
    await c.svc.announceTerms('v3', null);
    await expect(c.svc.announceTerms('v3', null)).rejects.toMatchObject({
      response: { code: 'ANNOUNCEMENT_RUNNING' },
    });
  });
});

// ─── Exercise re-test ────────────────────────────────────────────────────

describe('ExerciseHealthService re-test queue', () => {
  it('runs every reference solution of the language and audits the results', async () => {
    const audits: Record<string, unknown>[] = [];
    const prisma = {
      exercise: {
        findMany: jest.fn(async () => [
          {
            id: 'e1',
            lesson: { id: 'l1', module: { course: { sourceLocale: 'en-US' } } },
          },
          {
            id: 'e2',
            lesson: { id: 'l2', module: { course: { sourceLocale: 'en-US' } } },
          },
        ]),
      },
      contentTranslation: {
        findMany: jest.fn(async () => [
          { entityId: 'l1', locale: 'en-US', value: 'Sum' },
        ]),
      },
      auditLog: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          audits.push(data);
          return data;
        }),
        findMany: jest.fn(async () => []),
      },
    };
    const exercises = {
      verifyReference: jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          verdict: 'PASS',
          scorePct: 100,
          results: [],
        })
        .mockResolvedValueOnce({
          ok: false,
          verdict: 'FAIL',
          scorePct: 50,
          results: [{ name: 'adds negatives', passed: false }],
        }),
    };
    const svc = new ExerciseHealthService(prisma as never, exercises as never);
    const job = await svc.enqueueRetest(staff('ADMIN'), 'javascript', 'en-US');
    expect(job).toMatchObject({ status: 'queued', total: 2 });
    await expect(
      svc.enqueueRetest(staff('ADMIN'), 'javascript', 'en-US'),
    ).rejects.toMatchObject({ response: { code: 'RETEST_RUNNING' } });
    await svc.idle();
    const list = await svc.listRetests();
    expect(list.items[0]).toMatchObject({
      status: 'done',
      done: 2,
      passed: 1,
      failed: 1,
    });
    expect(list.items[0].results[0]).toMatchObject({
      lessonTitle: 'Sum',
      ok: true,
    });
    expect(list.items[0].results[1].message).toBe('Failing: adds negatives');
    expect(audits[0]).toMatchObject({ action: 'exercise.bulk_retest' });
    await expect(
      svc.enqueueRetest(staff('ADMIN'), 'cobol', 'en-US'),
    ).rejects.toMatchObject({ response: { code: 'LANGUAGE_NOT_SUPPORTED' } });
  });
});
