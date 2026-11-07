import { toProblemDetails } from '@codify/api-client';
import { errorMessageKey } from '../platform/app-toast.service.js';
import { retryAfterSeconds } from './reward-grant.js';

export interface RunnerError {
  key: string;
  params?: Record<string, unknown>;
}

const CODE_KEYS: Record<string, string> = {
  SUBMIT_COOLDOWN: 'student.runner.errors.cooldown',
  AI_SUBMIT_COOLDOWN: 'student.runner.errors.cooldown',
  SCENARIO_COOLDOWN: 'student.runner.errors.cooldown',
  QUIZ_ATTEMPT_COOLDOWN: 'student.runner.errors.cooldown',
  AI_RATE_LIMIT_MINUTE: 'student.runner.errors.minuteLimit',
  SUBMIT_DAILY_LIMIT: 'student.runner.errors.dailyLimit',
  AI_RATE_LIMIT_DAY: 'student.runner.errors.dailyLimit',
  NO_ATTEMPTS_LEFT: 'student.runner.errors.noAttempts',
  RUNNER_UNAVAILABLE: 'student.runner.errors.runnerUnavailable',
  LANGUAGE_NOT_SUPPORTED: 'student.runner.errors.runnerUnavailable',
  INVALID_SCENARIO_PATH: 'student.runner.errors.invalidPath',
  IDEMPOTENCY_KEY_REUSED: 'student.runner.errors.duplicate',
  SUBMISSION_TIMEOUT: 'student.exercise.gradingTimeout',
};

/**
 * Translated message for a runner (exercise / AI prompt / scenario / quiz)
 * failure: the new 429 cooldown / rate-limit codes carry `retryAfter`, 409s
 * mean "already recorded"; everything else uses the platform mapping.
 */
export function runnerError(err: unknown): RunnerError {
  const p = toProblemDetails(err);
  const key = p.code ? CODE_KEYS[p.code] : undefined;
  if (key) {
    const seconds = retryAfterSeconds(p.data);
    return { key, params: { seconds: seconds ?? 0 } };
  }
  if (p.status === 429) {
    return {
      key: 'student.runner.errors.cooldown',
      params: { seconds: retryAfterSeconds(p.data) ?? 0 },
    };
  }
  if (p.status === 409) return { key: 'student.runner.errors.duplicate' };
  return { key: errorMessageKey(err) };
}
