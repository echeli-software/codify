import vm from 'node:vm';
import {
  deepEqual,
  type ExecutionErrorKind,
  type TestCase,
  type TestResult,
} from '@codify/domain';

/**
 * Code-execution seam. In production this is Judge0 on an isolated VPS
 * (docs/12-code-execution.md); locally the DevJsExecutor runs JavaScript in a
 * Node `vm` sandbox — no `require`/network, wall-time-limited so infinite
 * loops are caught — so the full submit → grade → reward loop works without
 * Judge0. Mirrors the BillingProvider dev-mode pattern.
 */

export const CODE_EXECUTOR = Symbol('CODE_EXECUTOR');

export interface RunRequest {
  language: string;
  code: string;
  entryFunction: string;
  tests: TestCase[];
  timeLimitMs: number;
}

export interface RunResponse {
  results: TestResult[];
  errorKind: ExecutionErrorKind;
  runtimeMs: number;
  output?: string;
}

export interface CodeExecutor {
  readonly mode: 'dev' | 'judge0';
  readonly supportedLanguages: string[];
  run(req: RunRequest): Promise<RunResponse>;
}

interface RawResult {
  id: string;
  name: string;
  actual?: unknown;
  error?: string;
  runtimeMs?: number;
}

export class DevJsExecutor implements CodeExecutor {
  readonly mode = 'dev' as const;
  readonly supportedLanguages = ['javascript'];

  async run(req: RunRequest): Promise<RunResponse> {
    if (req.language !== 'javascript') {
      return {
        results: [],
        errorKind: 'error',
        runtimeMs: 0,
        output: `The dev executor only runs JavaScript. Connect a Judge0 worker to run ${req.language}.`,
      };
    }

    const started = Date.now();
    const context = vm.createContext({
      // No require/process/network — just a no-op console.
      console: {
        log: () => undefined,
        error: () => undefined,
        warn: () => undefined,
      },
      __tests: req.tests.map((t) => ({ id: t.id, name: t.name, args: t.args })),
    });

    const harness = `${req.code}
;(function () {
  const __out = [];
  for (const __t of __tests) {
    const __s = Date.now();
    try {
      if (typeof ${req.entryFunction} !== 'function') throw new Error('Function "${req.entryFunction}" is not defined');
      const actual = ${req.entryFunction}(...__t.args);
      __out.push({ id: __t.id, name: __t.name, actual, runtimeMs: Date.now() - __s });
    } catch (e) {
      __out.push({ id: __t.id, name: __t.name, error: String((e && e.message) || e), runtimeMs: Date.now() - __s });
    }
  }
  return __out;
})()`;

    let raw: RawResult[];
    try {
      raw = vm.runInContext(harness, context, {
        timeout: req.timeLimitMs,
      }) as RawResult[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorKind: ExecutionErrorKind = /timed out/i.test(message)
        ? 'timeout'
        : 'runtime';
      return {
        results: [],
        errorKind,
        runtimeMs: Date.now() - started,
        output: message,
      };
    }

    // Compare actual vs expected outside the sandbox (host-side deepEqual).
    const results: TestResult[] = req.tests.map((t, i) => {
      const r = raw[i] ?? { id: t.id, name: t.name };
      if (r.error !== undefined) {
        return {
          id: t.id,
          name: t.name,
          passed: false,
          error: r.error,
          runtimeMs: r.runtimeMs,
        };
      }
      const passed = deepEqual(r.actual, t.expected);
      return {
        id: t.id,
        name: t.name,
        passed,
        actual: passed ? undefined : safe(r.actual),
        expected: passed ? undefined : t.expected,
        runtimeMs: r.runtimeMs,
      };
    });

    return { results, errorKind: null, runtimeMs: Date.now() - started };
  }
}

/** Make a vm-realm value safe to persist/serialize. */
function safe(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
