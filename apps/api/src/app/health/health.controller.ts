import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { REDIS_CLIENT, type RedisClient } from '../common/redis.module.js';
import { NoThrottle } from '../common/throttling/throttle.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type DependencyState = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: DependencyState;
  /** `not_configured` when REDIS_URL is unset (dev only). */
  redis: DependencyState | 'not_configured';
}

const PROBE_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Liveness + readiness probe for the load balancer / Coolify / uptime
 * monitors. Public and never throttled. Always answers 200: a failing
 * dependency flips `status` to `degraded` and its field to `down`, so
 * probes decide based on the body rather than getting a 500.
 */
@Controller('health')
@Public()
@NoThrottle()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.pingDatabase(),
      this.pingRedis(),
    ]);
    return {
      status: database === 'up' && redis !== 'down' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      database,
      redis,
    };
  }

  private async pingDatabase(): Promise<DependencyState> {
    try {
      await withTimeout(
        this.prisma.$queryRawUnsafe('SELECT 1'),
        PROBE_TIMEOUT_MS,
      );
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async pingRedis(): Promise<DependencyState | 'not_configured'> {
    if (!this.redis) return 'not_configured';
    try {
      const pong = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
