import { Logger } from '@nestjs/common';
import type { RedisClient } from '../common/redis.module.js';

/** docs/10 §3 "Default cap": ≤ 2 non-SYSTEM pushes per user per local day. */
export const PUSH_DAILY_CAP = 2;
/** docs/10 §3 "Anti-spam": never 2 pushes within 30 minutes. */
export const PUSH_MIN_SPACING_MS = 30 * 60 * 1000;
/** Day counters outlive any timezone's local day. */
const DAY_KEY_TTL_MS = 48 * 60 * 60 * 1000;

export type CapDecision = 'ok' | 'daily' | 'spacing';

/** The subset of ioredis the cap store uses (so tests can pass a fake). */
export type CapRedis = Pick<
  NonNullable<RedisClient>,
  'incr' | 'decr' | 'pexpire' | 'set' | 'del' | 'status'
>;

export interface CapReservation {
  dayKey: string;
  gapKey: string;
}

/**
 * Per-user push caps in Redis. `reserve` atomically-enough claims a slot:
 *   1. INCR the user's local-day counter; over the cap → undo, `daily`.
 *   2. SET the 30-minute spacing key NX; already set → undo, `spacing`.
 * Concurrent sends race on the INCR / SET NX and the loser undoes its step,
 * so the cap holds without a Lua script. When Redis is unset or down the
 * caps are skipped (allowed) with a throttled warning — a Redis outage must
 * not silence every push.
 */
export class PushCapStore {
  private readonly logger = new Logger('PushCaps');
  private lastWarn = 0;

  constructor(
    private readonly redis: CapRedis | null | undefined,
    private readonly prefix = 'codify:push',
  ) {}

  keys(userId: string, localDate: string): CapReservation {
    return {
      dayKey: `${this.prefix}:day:${userId}:${localDate}`,
      gapKey: `${this.prefix}:gap:${userId}`,
    };
  }

  /** Claim a slot. `null` reservation = caps unavailable (allowed). */
  async reserve(
    userId: string,
    localDate: string,
  ): Promise<{ decision: CapDecision; reservation: CapReservation | null }> {
    const redis = this.redis;
    if (!redis || (redis.status && redis.status !== 'ready')) {
      this.warn(
        redis
          ? `Redis not ready (${redis.status}) — push caps not enforced`
          : 'REDIS_URL unset — push caps not enforced',
      );
      return { decision: 'ok', reservation: null };
    }
    const keys = this.keys(userId, localDate);
    try {
      const count = await redis.incr(keys.dayKey);
      if (count === 1) await redis.pexpire(keys.dayKey, DAY_KEY_TTL_MS);
      if (count > PUSH_DAILY_CAP) {
        await redis.decr(keys.dayKey);
        return { decision: 'daily', reservation: null };
      }
      const gap = await redis.set(
        keys.gapKey,
        '1',
        'PX',
        PUSH_MIN_SPACING_MS,
        'NX',
      );
      if (gap !== 'OK') {
        await redis.decr(keys.dayKey);
        return { decision: 'spacing', reservation: null };
      }
      return { decision: 'ok', reservation: keys };
    } catch (err) {
      this.warn(
        `Redis error — push caps not enforced: ${(err as Error).message}`,
      );
      return { decision: 'ok', reservation: null };
    }
  }

  /** Give a slot back (nothing was actually delivered). Best-effort. */
  async release(reservation: CapReservation | null): Promise<void> {
    if (!reservation || !this.redis) return;
    try {
      await this.redis.decr(reservation.dayKey);
      await this.redis.del(reservation.gapKey);
    } catch {
      // The slot simply stays used until the keys expire.
    }
  }

  private warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarn < 60_000) return;
    this.lastWarn = now;
    this.logger.warn(message);
  }
}
