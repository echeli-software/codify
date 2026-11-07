import { type Env, parseEnv } from './env.schema.js';

let cached: Env | null = null;

/**
 * The validated environment, parsed from `process.env` on first call and
 * memoised. `main.ts` calls this before Nest boots so a bad config fails
 * fast with a full list of problems; DI consumers use `AppConfigService`.
 */
export function loadEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test helper: forget the memoised env so the next `loadEnv()` re-reads. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * True when scheduled jobs (@Cron) may run: `JOBS_ENABLED` is not false and
 * we're not inside jest. Read straight from `process.env` so it's usable in
 * `@Cron({ disabled })` decorator arguments, which evaluate at import time.
 */
export function jobsEnabled(): boolean {
  if (process.env['JEST_WORKER_ID'] !== undefined) return false;
  if (process.env['NODE_ENV'] === 'test') return false;
  const flag = (process.env['JOBS_ENABLED'] ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no');
}

/**
 * Rate limiting on/off (`THROTTLE_ENABLED`, default on). Read from
 * `process.env` so the throttler guard needs no extra DI; production config
 * validation refuses `false`.
 */
export function throttleEnabled(): boolean {
  if (process.env['NODE_ENV'] === 'production') return true;
  const flag = (process.env['THROTTLE_ENABLED'] ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no');
}
