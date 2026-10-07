import type { ExecutionErrorKind, TestCase, TestResult } from '@codify/domain';

/** Executor contract shared by every code-execution backend (docs/12). */

export interface RunRequest {
  language: string;
  code: string;
  entryFunction: string;
  tests: TestCase[];
  timeLimitMs: number;
  memoryLimitKb: number;
  /** Exercise.testHarness — replaces the generated data-driven runner when non-empty. */
  testHarness?: string | null;
}

export interface RunResponse {
  /** One result per requested test, in request order. */
  results: TestResult[];
  errorKind: ExecutionErrorKind;
  runtimeMs: number;
  memoryKb?: number;
  /** Compiler / runtime diagnostics (stderr), ANSI-stripped and truncated. */
  output?: string;
  /** What the student printed to stdout (non-protocol lines), truncated. */
  studentOutput?: string;
}

export interface CodeExecutor {
  readonly mode: 'dev' | 'judge0';
  readonly supportedLanguages: readonly string[];
  run(req: RunRequest): Promise<RunResponse>;
}

/** The runner itself is unreachable / broken (not the student's fault). */
export class ExecutorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorUnavailableError';
  }
}
