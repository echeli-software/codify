import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { reportMessage } from '../common/sentry.js';
import { AppConfigService } from '../config/app-config.service.js';
import { jobsEnabled } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One user whose coin ledger disagrees with their cached balance. */
export interface LedgerDriftMismatch {
  userId: string;
  /** Cached `User.coins`. */
  coins: number;
  /** SUM(CoinTransaction.delta). */
  sumDelta: number;
  /** `balanceAfter` of the latest CoinTransaction (null = no transactions). */
  latestBalanceAfter: number | null;
  transactionCount: number;
}

export interface LedgerDriftReport {
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usersChecked: number;
  mismatchCount: number;
  /** First MAX_REPORTED mismatches (mismatchCount has the full total). */
  mismatches: LedgerDriftMismatch[];
}

const MAX_REPORTED = 500;

interface DriftRow {
  userId: string;
  coins: number;
  sumDelta: bigint | number | null;
  latestBalanceAfter: number | null;
  transactionCount: bigint | number;
}

/**
 * Nightly coin-ledger drift check (docs/07 ledger invariants): for every
 * user, the latest `CoinTransaction.balanceAfter`, `SUM(delta)` and the
 * cached `User.coins` must agree. Mismatches are logged and reported to
 * Sentry; the last report is kept in memory for `GET /admin/ops/drift`.
 * Read-only — it never "fixes" balances.
 */
@Injectable()
export class LedgerDriftService {
  private readonly logger = new Logger(LedgerDriftService.name);
  private last: LedgerDriftReport | null = null;
  private running: Promise<LedgerDriftReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  lastReport(): LedgerDriftReport | null {
    return this.last;
  }

  /** Run now (coalesces with an in-flight run). */
  run(
    trigger: LedgerDriftReport['trigger'] = 'manual',
  ): Promise<LedgerDriftReport> {
    if (!this.running) {
      this.running = this.check(trigger).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  @Cron('15 6 * * *', {
    name: 'ledger-drift',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  async nightly(): Promise<void> {
    // 06:15 UTC = 03:15 in São Paulo, the quietest hour.
    if (!this.config.jobsEnabled) return;
    try {
      await this.run('scheduled');
    } catch (err) {
      this.logger.error(
        `ledger drift job failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async check(
    trigger: LedgerDriftReport['trigger'],
  ): Promise<LedgerDriftReport> {
    const started = Date.now();
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "User"`;
    const rows = await this.prisma.$queryRaw<DriftRow[]>`
      SELECT u.id AS "userId",
             u.coins AS "coins",
             COALESCE(s.sum_delta, 0)::bigint AS "sumDelta",
             l."balanceAfter" AS "latestBalanceAfter",
             COALESCE(s.tx_count, 0)::bigint AS "transactionCount"
        FROM "User" u
        LEFT JOIN (
          SELECT "userId", SUM(delta) AS sum_delta, COUNT(*) AS tx_count
            FROM "CoinTransaction" GROUP BY "userId"
        ) s ON s."userId" = u.id
        LEFT JOIN LATERAL (
          SELECT ct."balanceAfter" FROM "CoinTransaction" ct
           WHERE ct."userId" = u.id
           ORDER BY ct."createdAt" DESC, ct.id DESC
           LIMIT 1
        ) l ON TRUE
       WHERE u.coins <> COALESCE(s.sum_delta, 0)
          OR (l."balanceAfter" IS NOT NULL AND l."balanceAfter" <> u.coins)
       ORDER BY u.id`;

    const mismatches = rows.map(toMismatch);
    const finished = Date.now();
    const report: LedgerDriftReport = {
      trigger,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      usersChecked: Number(count),
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, MAX_REPORTED),
    };
    this.last = report;

    if (mismatches.length > 0) {
      this.logger.error(
        `Ledger drift: ${mismatches.length}/${report.usersChecked} user(s) mismatched — e.g. ${JSON.stringify(mismatches.slice(0, 5))}`,
      );
      reportMessage(
        `Coin ledger drift detected for ${mismatches.length} user(s)`,
        {
          level: 'error',
          tags: { job: 'ledger-drift' },
          extra: {
            sample: mismatches.slice(0, 20),
            usersChecked: report.usersChecked,
          },
        },
      );
    } else {
      this.logger.log(
        `Ledger drift check clean (${report.usersChecked} users, ${report.durationMs}ms)`,
      );
    }
    return report;
  }
}

function toMismatch(r: DriftRow): LedgerDriftMismatch {
  return {
    userId: r.userId,
    coins: Number(r.coins),
    sumDelta: Number(r.sumDelta ?? 0),
    latestBalanceAfter:
      r.latestBalanceAfter === null ? null : Number(r.latestBalanceAfter),
    transactionCount: Number(r.transactionCount),
  };
}
