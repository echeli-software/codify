import {
  Controller,
  DefaultValuePipe,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  ParseBoolPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { reportException } from '../common/sentry.js';
import { jobsEnabled } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ASSET_STORAGE, type AssetStorage } from './asset-storage.js';

/**
 * Daily orphan-asset sweep (docs/01 §6, docs/02 Asset).
 *
 *  1. **Abandoned uploads** — `confirmed = false` rows older than
 *     ASSET_SWEEP_UNCONFIRMED_HOURS (default 24): the presigned PUT expired
 *     15 minutes after issue, so these never became usable.
 *  2. **Unreferenced assets** — confirmed rows older than
 *     ASSET_SWEEP_UNREFERENCED_DAYS (default 30) whose id appears nowhere.
 *
 * "Referenced" (conservative — anything that might point at the asset):
 *  - columns: `Course.coverAssetId`, `Badge.iconAssetId`,
 *    `Item.spriteAssetId` / `thumbnailAssetId` — soft-deleted / inactive
 *    rows included, since they can be restored;
 *  - the asset id anywhere in the text of `Lesson.contentJson` (image and
 *    video blocks carry `assetId`; asset URLs and keys embed the id too —
 *    soft-deleted lessons included), every `ContentTranslation.value`
 *    (translated lesson bodies), `Scenario.graphJson`, AI-prompt texts and
 *    `GamificationConfig.value` (site settings).
 *
 * Storage objects are deleted first; a storage failure keeps the row for
 * the next run. Rows are deleted only if still in the state that made them
 * candidates. ASSET_SWEEP_DRY_RUN (default: true outside production) only
 * logs what would go. At most ASSET_SWEEP_MAX_DELETES (500) per run.
 */

export const ASSET_SWEEP_CRON = '41 4 * * *';

export interface AssetSweepPolicy {
  unconfirmedHours: number;
  unreferencedDays: number;
  dryRun: boolean;
  maxDeletes: number;
}

export function assetSweepPolicyFromEnv(
  env: NodeJS.ProcessEnv,
): AssetSweepPolicy {
  const num = (key: string, fallback: number) => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`${key}: expected a positive number, got "${raw}"`);
    return n;
  };
  const dry = env['ASSET_SWEEP_DRY_RUN']?.trim().toLowerCase();
  return {
    unconfirmedHours: num('ASSET_SWEEP_UNCONFIRMED_HOURS', 24),
    unreferencedDays: num('ASSET_SWEEP_UNREFERENCED_DAYS', 30),
    dryRun:
      dry === undefined || dry === ''
        ? env['NODE_ENV'] !== 'production'
        : !(dry === 'false' || dry === '0' || dry === 'no'),
    maxDeletes: Math.floor(num('ASSET_SWEEP_MAX_DELETES', 500)),
  };
}

export const ASSET_SWEEP_POLICY = Symbol('ASSET_SWEEP_POLICY');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every UUID-shaped token in `text`, lower-cased, added to `into`. */
export function collectIds(text: string, into: Set<string>): void {
  for (const m of text.matchAll(UUID)) into.add(m[0].toLowerCase());
}

export interface AssetSweepReport {
  dryRun: boolean;
  unconfirmed: { candidates: number; deleted: number };
  unreferenced: { candidates: number; deleted: number };
  failed: number;
  /** Ids (first 50) that were — or in a dry run would be — deleted. */
  sample: string[];
}

const PAGE = 500;

@Injectable()
export class AssetSweepService {
  private readonly log = new Logger('AssetSweep');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(ASSET_SWEEP_POLICY) private readonly policy: AssetSweepPolicy,
    private readonly audit: AuditService,
  ) {}

  @Cron(ASSET_SWEEP_CRON, { name: 'asset-sweep', timeZone: 'UTC' })
  async scheduled(): Promise<void> {
    if (!jobsEnabled()) return;
    try {
      const r = await this.sweep();
      this.log.log(
        `${r.dryRun ? '[dry run] would delete' : 'deleted'} ${r.unconfirmed.deleted} abandoned + ${r.unreferenced.deleted} unreferenced asset(s), ${r.failed} failed`,
      );
    } catch (err) {
      this.log.error(`asset sweep failed: ${(err as Error).message}`);
      reportException(err, { tags: { job: 'asset-sweep' } });
    }
  }

  /** Every asset id referenced anywhere (see the class comment). */
  async referencedIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const add = (v: string | null | undefined) => {
      if (v) collectIds(v, ids);
    };
    const [courses, badges, items] = await Promise.all([
      this.prisma.course.findMany({
        where: { coverAssetId: { not: null } },
        select: { coverAssetId: true },
      }),
      this.prisma.badge.findMany({
        where: { iconAssetId: { not: null } },
        select: { iconAssetId: true },
      }),
      this.prisma.item.findMany({
        select: { spriteAssetId: true, thumbnailAssetId: true },
      }),
    ]);
    courses.forEach((c) => add(c.coverAssetId));
    badges.forEach((b) => add(b.iconAssetId));
    items.forEach((i) => {
      add(i.spriteAssetId);
      add(i.thumbnailAssetId);
    });

    // Large text sources, paged by id.
    await this.scan(
      (cursor) =>
        this.prisma.lesson.findMany({
          select: { id: true, contentJson: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (r) => add(JSON.stringify(r.contentJson)),
    );
    await this.scan(
      (cursor) =>
        this.prisma.contentTranslation.findMany({
          select: { id: true, value: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (r) => add(r.value),
    );
    await this.scan(
      (cursor) =>
        this.prisma.scenario.findMany({
          select: { id: true, graphJson: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (r) => add(JSON.stringify(r.graphJson)),
    );
    await this.scan(
      (cursor) =>
        this.prisma.aiPrompt.findMany({
          select: { id: true, promptText: true, contextText: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (r) => {
        add(r.promptText);
        add(r.contextText);
      },
    );
    const configs = await this.prisma.gamificationConfig.findMany({
      select: { value: true },
    });
    configs.forEach((c) => add(JSON.stringify(c.value)));
    return ids;
  }

  private async scan<T extends { id: string }>(
    page: (cursor: string | null) => Promise<T[]>,
    each: (row: T) => void,
  ): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const rows = await page(cursor);
      rows.forEach(each);
      if (rows.length < PAGE) return;
      cursor = rows[rows.length - 1]?.id ?? null;
    }
  }

  async sweep(
    now = new Date(),
    opts: { dryRun?: boolean; actor?: ApiUser } = {},
  ): Promise<AssetSweepReport> {
    const dryRun = opts.dryRun ?? this.policy.dryRun;
    const report: AssetSweepReport = {
      dryRun,
      unconfirmed: { candidates: 0, deleted: 0 },
      unreferenced: { candidates: 0, deleted: 0 },
      failed: 0,
      sample: [],
    };
    let budget = this.policy.maxDeletes;

    const abandoned = await this.prisma.asset.findMany({
      where: {
        confirmed: false,
        createdAt: {
          lt: new Date(
            now.getTime() - this.policy.unconfirmedHours * 3_600_000,
          ),
        },
      },
      select: { id: true, key: true },
      orderBy: { createdAt: 'asc' },
      take: budget,
    });
    report.unconfirmed.candidates = abandoned.length;
    for (const a of abandoned) {
      if (budget <= 0) break;
      budget--;
      if (await this.remove(a, false, dryRun, report))
        report.unconfirmed.deleted++;
    }

    if (budget > 0) {
      const referenced = await this.referencedIds();
      const cutoff = new Date(
        now.getTime() - this.policy.unreferencedDays * 86_400_000,
      );
      const old = await this.prisma.asset.findMany({
        where: { confirmed: true, createdAt: { lt: cutoff } },
        select: { id: true, key: true },
        orderBy: { createdAt: 'asc' },
      });
      const orphans = old.filter((a) => !referenced.has(a.id.toLowerCase()));
      report.unreferenced.candidates = orphans.length;
      for (const a of orphans) {
        if (budget <= 0) break;
        budget--;
        if (await this.remove(a, true, dryRun, report))
          report.unreferenced.deleted++;
      }
    }

    if (!dryRun && (report.unconfirmed.deleted || report.unreferenced.deleted))
      await this.audit.record(opts.actor ?? null, {
        action: 'asset.swept',
        entity: 'Asset',
        diff: {
          unconfirmed: report.unconfirmed.deleted,
          unreferenced: report.unreferenced.deleted,
          failed: report.failed,
          sample: report.sample,
        },
      });
    return report;
  }

  private async remove(
    asset: { id: string; key: string },
    confirmed: boolean,
    dryRun: boolean,
    report: AssetSweepReport,
  ): Promise<boolean> {
    if (dryRun) {
      this.log.log(
        `[dry run] would delete ${confirmed ? 'unreferenced' : 'abandoned'} asset ${asset.id} (${asset.key})`,
      );
      if (report.sample.length < 50) report.sample.push(asset.id);
      return true;
    }
    try {
      await this.storage.delete(asset.key);
    } catch (err) {
      report.failed++;
      this.log.warn(
        `storage delete failed for ${asset.id}: ${(err as Error).message}`,
      );
      return false;
    }
    // Only if it is still what made it a candidate (e.g. not confirmed
    // meanwhile).
    const { count } = await this.prisma.asset.deleteMany({
      where: { id: asset.id, confirmed },
    });
    if (count && report.sample.length < 50) report.sample.push(asset.id);
    return count > 0;
  }
}

/**
 * POST /admin/assets/sweep?dryRun=true — ADMIN-only manual run of the daily
 * sweep (dry run by default). Answers the report; a real run is audited.
 */
@Controller('admin/assets')
export class AssetSweepController {
  constructor(private readonly sweeper: AssetSweepService) {}

  @Roles('ADMIN')
  @Post('sweep')
  @HttpCode(200)
  run(
    @CurrentUser() actor: ApiUser,
    @Query('dryRun', new DefaultValuePipe(true), ParseBoolPipe) dryRun: boolean,
  ): Promise<AssetSweepReport> {
    return this.sweeper.sweep(new Date(), { dryRun, actor });
  }
}
