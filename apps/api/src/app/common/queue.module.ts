import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { bullRootOptions } from './queue-options.js';

/**
 * The one BullMQ root connection for the whole API (REDIS_URL). Feature
 * modules import this and register their own queues with
 * `BullModule.registerQueue(...)`; `forRootAsync` here runs once no matter
 * how many modules import it, so there is exactly one root configuration.
 *
 * Queues: `code-submissions` (exercises), `billing-webhooks` (billing),
 * `push-deferred` (notifications).
 */
@Module({
  imports: [
    BullModule.forRootAsync({ useFactory: () => bullRootOptions(process.env) }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
