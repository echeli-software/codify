import { Logger } from '@nestjs/common';
import type { CodeExecutor } from './executor.types.js';
import { ChildProcessExecutor } from './child-process.executor.js';
import { Judge0Executor, parseJudge0LanguageIds } from './judge0.executor.js';

/**
 * Code-execution seam (docs/12-code-execution.md).
 *
 *   - Judge0Executor  — selected when JUDGE0_URL is set. Self-hosted Judge0
 *     on an isolated VPS; the only executor allowed in production.
 *   - ChildProcessExecutor — local development. Runs JavaScript (and
 *     TypeScript via Node's type stripping) in a separate Node process with
 *     an empty environment, Node's permission model, a heap cap, a wall-clock
 *     kill and an output cap. NOT a security boundary for hostile code — it
 *     exists so the submit → grade → reward loop works without Judge0.
 *
 * Production without JUDGE0_URL fails at boot.
 */

export const CODE_EXECUTOR = Symbol('CODE_EXECUTOR');

export {
  ExecutorUnavailableError,
  type CodeExecutor,
  type RunRequest,
  type RunResponse,
} from './executor.types.js';

export function createCodeExecutor(
  env: NodeJS.ProcessEnv = process.env,
): CodeExecutor {
  const log = new Logger('CodeExecutor');
  const url = env['JUDGE0_URL']?.trim();
  if (url) {
    const executor = new Judge0Executor({
      baseUrl: url,
      authToken: env['JUDGE0_AUTH_TOKEN']?.trim() || undefined,
      languageIds: parseJudge0LanguageIds(env['JUDGE0_LANGUAGE_IDS']),
    });
    log.log(
      `Judge0 executor → ${url} (${executor.supportedLanguages.join(', ')})`,
    );
    return executor;
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      'JUDGE0_URL is required in production (code execution must run on Judge0). Set JUDGE0_URL and JUDGE0_AUTH_TOKEN.',
    );
  }
  const executor = new ChildProcessExecutor();
  log.warn(
    `JUDGE0_URL not set — using the local child-process executor (${executor.supportedLanguages.join(', ')}). Dev only.`,
  );
  return executor;
}
