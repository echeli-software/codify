import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';

/** Injection token for the shared ioredis client (or `null` when unset). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClient = Redis | null;

/**
 * Builds the shared Redis client from `REDIS_URL`. Commands fail fast
 * (1 retry, 1s timeout) so a Redis outage degrades rate limiting / health
 * instead of hanging requests. `null` when REDIS_URL is unset (dev only —
 * production config validation requires it).
 */
export function createRedisClient(
  url: string | undefined,
  logger = new Logger('Redis'),
): RedisClient {
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  let lastError = '';
  client.on('error', (err: Error) => {
    // ioredis emits on every reconnect attempt; log each distinct error once.
    if (err.message !== lastError) {
      lastError = err.message;
      logger.warn(`Redis error: ${err.message}`);
    }
  });
  client.on('ready', () => {
    lastError = '';
  });
  client.connect().catch(() => undefined);
  return client;
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): RedisClient =>
        createRedisClient(config.get('REDIS_URL')),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
