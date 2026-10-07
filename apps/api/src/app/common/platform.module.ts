import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service.js';
import { buildLoggerParams } from './logging.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { flushSentry } from './sentry.js';
import { REDIS_CLIENT, RedisModule, type RedisClient } from './redis.module.js';
import { RedisThrottlerStorage } from './throttling/redis-throttler.storage.js';
import { THROTTLERS } from './throttling/throttler.config.js';
import { UserThrottlerGuard } from './throttling/user-throttler.guard.js';

/** Flush buffered Sentry events on graceful shutdown (SIGTERM from Coolify). */
@Injectable()
class SentryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await flushSentry();
  }
}

/**
 * Cross-cutting HTTP platform: structured logging (nestjs-pino), the
 * shared Redis client, rate limiting (Redis-backed when REDIS_URL is set)
 * and the global problem+json exception filter.
 */
@Module({
  imports: [
    RedisModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => buildLoggerParams(config),
    }),
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisClient) => ({
        throttlers: THROTTLERS,
        storage: redis ? new RedisThrottlerStorage(redis) : undefined,
        errorMessage:
          'Too many requests — slow down and retry after the indicated delay',
      }),
    }),
  ],
  providers: [
    SentryLifecycle,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class PlatformModule {}
