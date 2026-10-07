import { Logger } from '@nestjs/common';
import {
  type ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/**
 * Fixed-window counter + block key, atomically in one round trip.
 *   KEYS[1] hit counter   KEYS[2] block marker
 *   ARGV[1] ttl ms        ARGV[2] limit        ARGV[3] block ms
 * Returns { hits, counterTtlMs, blocked(0/1), blockTtlMs }.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local ttl = redis.call('PTTL', KEYS[1])
  return { hits, ttl, 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Redis-backed ThrottlerStorage so limits hold across API instances
 * (docs/14 §7). If Redis is unreachable the request is counted in the
 * in-process store instead — rate limiting degrades to per-instance
 * rather than failing the request or failing open entirely.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private warned = false;

  constructor(
    private readonly redis: Pick<Redis, 'eval'> & { readonly status?: string },
    private readonly prefix = 'codify:',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const blockMs = blockDuration > 0 ? blockDuration : ttl;
    // Circuit breaker: while the client is reconnecting, don't make every
    // request wait for a command timeout — count in memory instead.
    if (this.redis.status !== undefined && this.redis.status !== 'ready') {
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
    try {
      const raw = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${this.prefix}${key}`,
        `${this.prefix}${key}:blocked`,
        String(ttl),
        String(limit),
        String(blockMs),
      )) as [number, number, number, number];
      this.warned = false;
      const [hits, counterTtl, blocked, blockTtl] = raw.map(Number);
      return {
        totalHits: hits,
        timeToExpire: toSeconds(counterTtl),
        isBlocked: blocked === 1,
        timeToBlockExpire: blocked === 1 ? toSeconds(blockTtl) : 0,
      };
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `Redis throttler unavailable, using in-memory buckets: ${(err as Error).message}`,
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }
}
