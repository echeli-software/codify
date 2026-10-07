import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import { reportMessage } from '../common/sentry.js';
import { LedgerDriftService } from './ledger-drift.service.js';

// @nestjs/schedule ships ESM-only; this jest config doesn't transform it.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_HOUR: '0 0-23/1 * * *' },
}));

jest.mock('../common/sentry.js', () => ({ reportMessage: jest.fn() }));

const config = new AppConfigService(parseEnv({ DATABASE_URL: 'postgres://x' }));

function setup(mismatchRows: unknown[]) {
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ count: BigInt(42) }])
      .mockResolvedValueOnce(mismatchRows),
  };
  return { prisma, svc: new LedgerDriftService(prisma as never, config) };
}

describe('LedgerDriftService', () => {
  beforeEach(() => jest.mocked(reportMessage).mockClear());

  it('reports a clean ledger and remembers the last run', async () => {
    const { svc } = setup([]);
    expect(svc.lastReport()).toBeNull();
    const report = await svc.run('manual');
    expect(report).toMatchObject({
      trigger: 'manual',
      usersChecked: 42,
      mismatchCount: 0,
      mismatches: [],
    });
    expect(svc.lastReport()).toBe(report);
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('normalises bigint columns and reports mismatches to Sentry', async () => {
    const { svc } = setup([
      {
        userId: 'u1',
        coins: 50,
        sumDelta: BigInt(40),
        latestBalanceAfter: 40,
        transactionCount: BigInt(3),
      },
      {
        userId: 'u2',
        coins: 10,
        sumDelta: BigInt(0),
        latestBalanceAfter: null,
        transactionCount: BigInt(0),
      },
    ]);
    const report = await svc.run('scheduled');
    expect(report.mismatchCount).toBe(2);
    expect(report.mismatches[0]).toEqual({
      userId: 'u1',
      coins: 50,
      sumDelta: 40,
      latestBalanceAfter: 40,
      transactionCount: 3,
    });
    expect(report.mismatches[1].latestBalanceAfter).toBeNull();
    expect(reportMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 user'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('coalesces concurrent runs', async () => {
    const { svc, prisma } = setup([]);
    const [a, b] = await Promise.all([svc.run(), svc.run()]);
    expect(a).toBe(b);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // count + mismatch query, once
  });

  it('the cron entry point is a no-op when jobs are disabled (always, under jest)', async () => {
    const { svc, prisma } = setup([]);
    await svc.nightly();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
