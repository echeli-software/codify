import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { FeatureFlag, Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  evaluateFlag,
  parseFlagValue,
  type FlagEvaluation,
  type FlagRow,
  type FlagValue,
} from './flag-evaluation.js';

/** Flags the product depends on; created on boot when missing (never overwritten). */
export const DEFAULT_FLAGS: ReadonlyArray<{
  key: string;
  value: FlagValue;
  description: string;
}> = [
  {
    key: 'leagues.enabled',
    value: { enabled: true, surface: 'student' },
    description: 'Weekly leagues (docs/07 §9): League tab and /league API.',
  },
  {
    key: 'friends.enabled',
    value: { enabled: true, surface: 'student' },
    description: 'Friends, requests, invites and nudges (/friends API).',
  },
  {
    key: 'shop.enabled',
    value: { enabled: true, surface: 'student' },
    description: 'Avatar shop (docs/08): Shop tab and /shop API.',
  },
];

export const FLAG_CACHE_TTL_MS = 30_000;
export const PUBLIC_SURFACE = 'public';

export interface FeatureFlagView {
  key: string;
  value: FlagValue;
  description: string | null;
  isActive: boolean;
  /** Built-in flags cannot be deleted (disable them instead). */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlagInput {
  value: unknown;
  description?: string | null;
  isActive?: boolean;
}

const KEY_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

/**
 * Postgres-backed feature flags (docs/10 §9). All rows are read at once
 * and cached in memory for FLAG_CACHE_TTL_MS; admin writes through this
 * service invalidate the cache immediately (other API replicas pick the
 * change up within the TTL). Evaluation is pure — see flag-evaluation.ts
 * for the bucketing contract.
 */
@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagService.name);
  private cache: { at: number; rows: Map<string, FlagRow> } | null = null;
  private loading: Promise<Map<string, FlagRow>> | null = null;

  /** Clock (overridable in tests). */
  now: () => number = Date.now;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaults();
    } catch (err) {
      // Evaluation falls back to the built-in defaults when a row is missing.
      this.logger.warn(
        `Could not seed default feature flags: ${(err as Error).message}`,
      );
    }
  }

  /** Insert the built-in rows that do not exist yet (idempotent, no overwrite). */
  async ensureDefaults(): Promise<number> {
    const res = await this.prisma.featureFlag.createMany({
      data: DEFAULT_FLAGS.map((f) => ({
        key: f.key,
        value: f.value as unknown as Prisma.InputJsonValue,
        description: f.description,
      })),
      skipDuplicates: true,
    });
    if (res.count) this.invalidate();
    return res.count;
  }

  invalidate(): void {
    this.cache = null;
  }

  async evaluate(key: string, userId?: string | null): Promise<FlagEvaluation> {
    const rows = await this.rows();
    return evaluateFlag(rows.get(key) ?? defaultRow(key), userId);
  }

  async isEnabled(key: string, userId?: string | null): Promise<boolean> {
    return (await this.evaluate(key, userId)).enabled;
  }

  /**
   * Every flag evaluated for the caller. Anonymous callers only see flags
   * whose surface is 'public'.
   */
  async evaluateAll(
    userId: string | null,
  ): Promise<Record<string, FlagEvaluation>> {
    const rows = new Map(await this.rows());
    for (const d of DEFAULT_FLAGS)
      if (!rows.has(d.key)) rows.set(d.key, defaultRow(d.key) as FlagRow);
    const out: Record<string, FlagEvaluation> = {};
    for (const row of [...rows.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      if (!userId && row.value.surface !== PUBLIC_SURFACE) continue;
      out[row.key] = evaluateFlag(row, userId);
    }
    return out;
  }

  // ─── Admin CRUD ──────────────────────────────────────────────────────

  async list(): Promise<FeatureFlagView[]> {
    const rows = await this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });
    return rows.map(toView);
  }

  async create(key: string, input: FlagInput): Promise<FeatureFlagView> {
    if (!KEY_RE.test(key) || key.length > 80) {
      throw new BadRequestException({
        code: 'INVALID_FLAG',
        message:
          'key must be lowercase segments of a-z 0-9 _ - separated by dots (max 80)',
        errors: { key: ['invalid format'] },
      });
    }
    const value = validValue(input.value);
    try {
      const row = await this.prisma.featureFlag.create({
        data: {
          key,
          value: value as unknown as Prisma.InputJsonValue,
          description: input.description ?? null,
          isActive: input.isActive ?? true,
        },
      });
      this.invalidate();
      return toView(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({
          code: 'FLAG_EXISTS',
          message: `Feature flag "${key}" already exists`,
        });
      throw err;
    }
  }

  async update(
    key: string,
    input: Partial<FlagInput>,
  ): Promise<{ before: FeatureFlagView; after: FeatureFlagView }> {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key },
    });
    if (!existing) throw flagNotFound(key);
    const data: Prisma.FeatureFlagUpdateInput = {};
    if (input.value !== undefined)
      data.value = validValue(input.value) as unknown as Prisma.InputJsonValue;
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const row = await this.prisma.featureFlag.update({ where: { key }, data });
    this.invalidate();
    return { before: toView(existing), after: toView(row) };
  }

  async remove(key: string): Promise<FeatureFlagView> {
    if (isBuiltIn(key)) {
      throw new ConflictException({
        code: 'FLAG_BUILT_IN',
        message: `"${key}" is a built-in flag — disable it instead of deleting it`,
      });
    }
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key },
    });
    if (!existing) throw flagNotFound(key);
    await this.prisma.featureFlag.delete({ where: { key } });
    this.invalidate();
    return toView(existing);
  }

  // ─── Cache ───────────────────────────────────────────────────────────

  private async rows(): Promise<Map<string, FlagRow>> {
    const now = this.now();
    if (this.cache && now - this.cache.at < FLAG_CACHE_TTL_MS)
      return this.cache.rows;
    if (!this.loading) {
      this.loading = this.load()
        .then((rows) => {
          this.cache = { at: this.now(), rows };
          return rows;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  private async load(): Promise<Map<string, FlagRow>> {
    const rows = await this.prisma.featureFlag.findMany({
      select: { key: true, value: true, isActive: true },
    });
    const map = new Map<string, FlagRow>();
    for (const r of rows) {
      const parsed = parseFlagValue(r.value);
      if (!parsed.ok) {
        this.logger.warn(
          `Feature flag "${r.key}" has an invalid value (${parsed.errors.join('; ')}) — treated as disabled`,
        );
        map.set(r.key, {
          key: r.key,
          value: { enabled: false },
          isActive: false,
        });
        continue;
      }
      map.set(r.key, { key: r.key, value: parsed.value, isActive: r.isActive });
    }
    return map;
  }
}

function isBuiltIn(key: string): boolean {
  return DEFAULT_FLAGS.some((d) => d.key === key);
}

/** A built-in flag whose row is missing evaluates as its default. */
function defaultRow(key: string): FlagRow | null {
  const d = DEFAULT_FLAGS.find((f) => f.key === key);
  return d ? { key, value: d.value, isActive: true } : null;
}

function validValue(raw: unknown): FlagValue {
  const parsed = parseFlagValue(raw);
  if (!parsed.ok) {
    throw new BadRequestException({
      code: 'INVALID_FLAG',
      message: parsed.errors.join('; '),
      errors: { value: parsed.errors },
    });
  }
  return parsed.value;
}

function flagNotFound(key: string): NotFoundException {
  return new NotFoundException({
    code: 'FLAG_NOT_FOUND',
    message: `Feature flag "${key}" not found`,
  });
}

function toView(row: FeatureFlag): FeatureFlagView {
  const parsed = parseFlagValue(row.value);
  return {
    key: row.key,
    value: parsed.ok ? parsed.value : { enabled: false },
    description: row.description,
    isActive: row.isActive,
    builtIn: isBuiltIn(row.key),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
