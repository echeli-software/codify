import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_EARNING_BY_TYPE,
  DEFAULT_LEAGUE_ZONES,
  validateLeagueZones,
  type LeagueZoneConfig,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

export interface RewardAmount {
  xp: number;
  coins: number;
}

/** Every admin-editable gamification knob, with its type. */
export interface GamificationConfigValues {
  /** Ceiling on the effective stacked multiplier (docs/07 §3). */
  'multiplier.cap': number;
  /** Days a PAST_DUE subscription keeps access (docs/09 §status table). */
  'billing.pastDueGraceDays': number;
  /**
   * Coins granted once per subscription on its first paid invoice (or a
   * PIX/Boleto prepay) — docs/09 §5 step 7. 0 = off.
   */
  'billing.firstPaymentBonusCoins': number;
  /** Days after the bonus during which a full refund claws it back (docs/09 §5, §12). */
  'billing.refundWindowDays': number;
  /** Max streak freezes a user can bank (docs/07 §6). */
  'streak.freezeCap': number;
  /** One-time streak-day milestone payouts, keyed by day count (docs/07 §2). */
  'streak.milestones': Record<string, RewardAmount>;
  /** Weekly league promotion reward (docs/07 §9). */
  'league.promotionReward': RewardAmount & { freeze: number };
  /** Extra reward for finishing #1 in a cohort (docs/07 §9). */
  'league.rank1Reward': RewardAmount;
  /** Daily quests assigned per user (docs/07 §8). */
  'quest.dailyCount': number;
  /** Reward to the referrer once a referee completes their first lesson. */
  'referral.reward': RewardAmount;
  /** Days after signup during which a referral code may be claimed. */
  'referral.claimWindowDays': number;
  /**
   * First-completion reward per lesson type (docs/07 §2). Applies when the
   * lesson's own baseXp / baseCoins are still at the column default
   * (10 / 5) — see `lessonBaseReward` in @codify/domain.
   */
  'earning.byLessonType': Record<string, RewardAmount>;
  /** Extra reward for a 100 % quiz, journaled as its own QUIZ_PERFECT rows. */
  'earning.quizPerfectBonus': RewardAmount;
  /** Extra reward per correctly answered quiz question (0 = off). */
  'earning.quizPerQuestionBonus': RewardAmount;
  /** Exercise / AI-prompt pass after the first: once per lesson per local day (RETAKE). */
  'earning.retake': RewardAmount;
  /** A newly reached scenario ending (SCENARIO_BRANCH), at most `dailyCap` per scenario per day. */
  'earning.scenarioBranch': RewardAmount & { dailyCap: number };
  /**
   * Daily coin cap per CoinSource, user-local day (docs/07 §5, §12). Sources
   * not listed are uncapped. The excess goes to the weekly bonus pool.
   */
  'coins.dailyCaps': Record<string, number>;
  /** Max coins held in a user's weekly bonus pool (paid at week close, WEEKLY_BONUS). */
  'coins.weeklyPoolCap': number;
  /** League promotion / relegation zone sizes (docs/07 §9). */
  'league.zones': LeagueZoneConfig;
  /** Surprise XP boosts (docs/10 §6): chance per completion, length, weekly limit. */
  'boost.surprise': {
    chancePct: number;
    value: number;
    minutes: number;
    maxPerWeek: number;
  };
}

export type GamificationConfigKey = keyof GamificationConfigValues;

export const GAMIFICATION_CONFIG_DEFAULTS: GamificationConfigValues = {
  'multiplier.cap': 30,
  'billing.pastDueGraceDays': 3,
  'billing.firstPaymentBonusCoins': 0,
  'billing.refundWindowDays': 7,
  'streak.freezeCap': 2,
  'streak.milestones': {
    '7': { xp: 0, coins: 50 },
    '14': { xp: 0, coins: 100 },
    '30': { xp: 0, coins: 200 },
    '100': { xp: 100, coins: 500 },
    '365': { xp: 500, coins: 2000 },
  },
  'league.promotionReward': { xp: 50, coins: 100, freeze: 1 },
  'league.rank1Reward': { xp: 25, coins: 50 },
  'quest.dailyCount': 3,
  'referral.reward': { xp: 50, coins: 200 },
  'referral.claimWindowDays': 14,
  'earning.byLessonType': { ...DEFAULT_EARNING_BY_TYPE },
  'earning.quizPerfectBonus': { xp: 10, coins: 5 },
  'earning.quizPerQuestionBonus': { xp: 0, coins: 0 },
  'earning.retake': { xp: 5, coins: 2 },
  'earning.scenarioBranch': { xp: 10, coins: 5, dailyCap: 3 },
  'coins.dailyCaps': { LESSON_COMPLETE: 200 },
  'coins.weeklyPoolCap': 500,
  'league.zones': { ...DEFAULT_LEAGUE_ZONES },
  'boost.surprise': { chancePct: 10, value: 2, minutes: 15, maxPerWeek: 2 },
};

/** CoinSources a daily cap may name (earn sources; spends are never capped). */
export const CAPPABLE_COIN_SOURCES = [
  'LESSON_COMPLETE',
  'QUIZ_PERFECT',
  'EXERCISE_PASS',
  'AI_PROMPT_PASS',
  'SCENARIO_COMPLETE',
  'CAPSTONE_PASS',
  'RETAKE',
  'SCENARIO_BRANCH',
  'DAILY_QUEST',
  'BADGE_UNLOCK',
  'STREAK_MILESTONE',
] as const;

const LESSON_TYPES = [
  'READING',
  'QUIZ',
  'EXERCISE',
  'AI_PROMPT',
  'SCENARIO',
  'CAPSTONE',
];

export const GAMIFICATION_CONFIG_KEYS = Object.keys(
  GAMIFICATION_CONFIG_DEFAULTS,
) as GamificationConfigKey[];

export interface ConfigEntryView<
  K extends GamificationConfigKey = GamificationConfigKey,
> {
  key: K;
  value: GamificationConfigValues[K];
  defaultValue: GamificationConfigValues[K];
  isDefault: boolean;
  updatedAt: string | null;
}

const MAX_REWARD = 100_000;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isReward(v: unknown, extra: string[] = []): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const allowed = new Set(['xp', 'coins', ...extra]);
  if (Object.keys(o).some((k) => !allowed.has(k))) return false;
  return (
    isInt(o['xp'], 0, MAX_REWARD) &&
    isInt(o['coins'], 0, MAX_REWARD) &&
    extra.every((k) => isInt(o[k], 0, 10))
  );
}

/** Returns an error message, or null when `value` is valid for `key`. */
export function validateConfigValue(
  key: GamificationConfigKey,
  value: unknown,
): string | null {
  switch (key) {
    case 'multiplier.cap':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 100
        ? null
        : 'must be a number between 1 and 100';
    case 'billing.pastDueGraceDays':
      return isInt(value, 0, 30) ? null : 'must be an integer between 0 and 30';
    case 'billing.firstPaymentBonusCoins':
      return isInt(value, 0, MAX_REWARD)
        ? null
        : `must be an integer between 0 and ${MAX_REWARD}`;
    case 'billing.refundWindowDays':
      return isInt(value, 0, 365)
        ? null
        : 'must be an integer between 0 and 365';
    case 'streak.freezeCap':
      return isInt(value, 0, 10) ? null : 'must be an integer between 0 and 10';
    case 'quest.dailyCount':
      return isInt(value, 1, 10) ? null : 'must be an integer between 1 and 10';
    case 'referral.claimWindowDays':
      return isInt(value, 0, 365)
        ? null
        : 'must be an integer between 0 and 365';
    case 'streak.milestones': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return 'must be an object of { "<days>": { xp, coins } }';
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 50) return 'at most 50 milestones';
      for (const [day, reward] of entries) {
        if (!/^[1-9]\d{0,4}$/.test(day))
          return `milestone key "${day}" must be a positive day count`;
        if (!isReward(reward))
          return `milestone ${day} must be { xp, coins } with non-negative integers`;
      }
      return null;
    }
    case 'league.promotionReward':
      return isReward(value, ['freeze'])
        ? null
        : 'must be { xp, coins, freeze } with non-negative integers (freeze ≤ 10)';
    case 'league.rank1Reward':
    case 'referral.reward':
    case 'earning.quizPerfectBonus':
    case 'earning.quizPerQuestionBonus':
    case 'earning.retake':
      return isReward(value)
        ? null
        : 'must be { xp, coins } with non-negative integers';
    case 'earning.scenarioBranch':
      return isReward(value, ['dailyCap'])
        ? null
        : 'must be { xp, coins, dailyCap } with non-negative integers (dailyCap ≤ 10)';
    case 'earning.byLessonType': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return 'must be an object of { "<LESSON_TYPE>": { xp, coins } }';
      for (const [type, reward] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!LESSON_TYPES.includes(type))
          return `"${type}" must be one of ${LESSON_TYPES.join(', ')}`;
        if (!isReward(reward))
          return `${type} must be { xp, coins } with non-negative integers`;
      }
      return null;
    }
    case 'coins.dailyCaps': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return 'must be an object of { "<COIN_SOURCE>": cap }';
      for (const [source, cap] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!(CAPPABLE_COIN_SOURCES as readonly string[]).includes(source))
          return `"${source}" must be one of ${CAPPABLE_COIN_SOURCES.join(', ')}`;
        if (!isInt(cap, 0, MAX_REWARD))
          return `${source} cap must be an integer between 0 and ${MAX_REWARD}`;
      }
      return null;
    }
    case 'coins.weeklyPoolCap':
      return isInt(value, 0, MAX_REWARD)
        ? null
        : `must be an integer between 0 and ${MAX_REWARD}`;
    case 'league.zones': {
      const errs = validateLeagueZones(value);
      return errs.length ? errs.join('; ') : null;
    }
    case 'boost.surprise': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return 'must be { chancePct, value, minutes, maxPerWeek }';
      const o = value as Record<string, unknown>;
      const allowed = ['chancePct', 'value', 'minutes', 'maxPerWeek'];
      if (Object.keys(o).some((k) => !allowed.includes(k)))
        return `only ${allowed.join(', ')} are allowed`;
      if (!isInt(o['chancePct'], 0, 100))
        return 'chancePct must be an integer between 0 and 100';
      if (
        typeof o['value'] !== 'number' ||
        !Number.isFinite(o['value']) ||
        o['value'] < 1 ||
        o['value'] > 5
      )
        return 'value must be a number between 1 and 5';
      if (!isInt(o['minutes'], 1, 120))
        return 'minutes must be an integer between 1 and 120';
      if (!isInt(o['maxPerWeek'], 0, 7))
        return 'maxPerWeek must be an integer between 0 and 7';
      return null;
    }
    default:
      return 'unknown key';
  }
}

export function isConfigKey(key: string): key is GamificationConfigKey {
  return (GAMIFICATION_CONFIG_KEYS as string[]).includes(key);
}

/**
 * Typed access to the `GamificationConfig` key/value table. Known keys only,
 * each with a default (used when the row is absent or holds an invalid value,
 * so a bad manual DB edit can never break the reward path).
 */
@Injectable()
export class GamificationConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read one key (inside `tx` when given). */
  async get<K extends GamificationConfigKey>(
    key: K,
    tx?: Tx,
  ): Promise<GamificationConfigValues[K]> {
    const db = tx ?? this.prisma;
    const row = await db.gamificationConfig.findUnique({ where: { key } });
    return coerce(key, row?.value);
  }

  /** Read several keys in one query. */
  async getMany<K extends GamificationConfigKey>(
    keys: K[],
    tx?: Tx,
  ): Promise<Pick<GamificationConfigValues, K>> {
    const db = tx ?? this.prisma;
    const rows = await db.gamificationConfig.findMany({
      where: { key: { in: keys } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out = {} as Pick<GamificationConfigValues, K>;
    for (const k of keys) out[k] = coerce(k, byKey.get(k));
    return out;
  }

  /** Every known key with its effective value and default (admin screen). */
  async list(): Promise<ConfigEntryView[]> {
    const rows = await this.prisma.gamificationConfig.findMany({
      where: { key: { in: GAMIFICATION_CONFIG_KEYS } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return GAMIFICATION_CONFIG_KEYS.map((key) => {
      const row = byKey.get(key);
      const valid = row && validateConfigValue(key, row.value) === null;
      return {
        key,
        value: coerce(key, row?.value),
        defaultValue: GAMIFICATION_CONFIG_DEFAULTS[key],
        isDefault: !valid,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      } as ConfigEntryView;
    });
  }

  /**
   * Validate and upsert a partial set of keys. `null` resets a key to its
   * default (deletes the row). All-or-nothing: any invalid key rejects the
   * whole request. Returns the previous values for the audit diff.
   */
  async update(
    patch: Record<string, unknown>,
  ): Promise<{ entries: ConfigEntryView[]; before: Record<string, unknown> }> {
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new BadRequestException('No keys to update');
    const errors: string[] = [];
    for (const key of keys) {
      if (!isConfigKey(key)) {
        errors.push(`${key}: unknown key`);
        continue;
      }
      if (patch[key] === null) continue;
      const err = validateConfigValue(key, patch[key]);
      if (err) errors.push(`${key}: ${err}`);
    }
    if (errors.length) throw new BadRequestException(errors);

    const before: Record<string, unknown> = {};
    const existing = await this.prisma.gamificationConfig.findMany({
      where: { key: { in: keys } },
    });
    for (const k of keys) {
      before[k] = existing.find((r) => r.key === k)?.value ?? null;
    }

    await this.prisma.$transaction(
      keys.map((key) =>
        patch[key] === null
          ? this.prisma.gamificationConfig.deleteMany({ where: { key } })
          : this.prisma.gamificationConfig.upsert({
              where: { key },
              create: { key, value: patch[key] as Prisma.InputJsonValue },
              update: { value: patch[key] as Prisma.InputJsonValue },
            }),
      ),
    );
    return { entries: await this.list(), before };
  }
}

function coerce<K extends GamificationConfigKey>(
  key: K,
  raw: unknown,
): GamificationConfigValues[K] {
  if (
    raw !== undefined &&
    raw !== null &&
    validateConfigValue(key, raw) === null
  )
    return raw as GamificationConfigValues[K];
  return GAMIFICATION_CONFIG_DEFAULTS[key];
}
