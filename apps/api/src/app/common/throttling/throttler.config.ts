import type { ExecutionContext } from '@nestjs/common';
import {
  type ThrottlerOptions,
  days,
  minutes,
  seconds,
} from '@nestjs/throttler';
import { type ThrottleGroup, throttleGroupsOf } from './throttle.decorators.js';
import { ipTracker } from './trackers.js';

const onlyFor =
  (group: ThrottleGroup) =>
  (ctx: ExecutionContext): boolean =>
    !throttleGroupsOf(ctx).includes(group);

/**
 * Named throttlers (docs/14 §7). ttl/blockDuration are milliseconds
 * (@nestjs/throttler v6). The tracker is the user id when authenticated,
 * the client IP otherwise — except `ip`, which always keys on the IP.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: minutes(1), limit: 60 },
  {
    name: 'ip',
    ttl: minutes(1),
    limit: 600,
    getTracker: (req) => ipTracker(req),
  },
  { name: 'reward', ttl: minutes(1), limit: 10, skipIf: onlyFor('reward') },
  { name: 'ai-minute', ttl: minutes(1), limit: 5, skipIf: onlyFor('ai') },
  { name: 'ai-day', ttl: days(1), limit: 60, skipIf: onlyFor('ai') },
  { name: 'code-burst', ttl: seconds(3), limit: 1, skipIf: onlyFor('code') },
  { name: 'code-day', ttl: days(1), limit: 200, skipIf: onlyFor('code') },
];
