import type { ExecutionErrorKind } from '@codify/domain';
import {
  buildHarness,
  cleanOutput,
  parseHarnessOutput,
  type HarnessLanguage,
} from './harness.js';
import {
  ExecutorUnavailableError,
  type CodeExecutor,
  type RunRequest,
  type RunResponse,
} from './executor.types.js';

/**
 * Judge0 language ids. Defaults are Judge0 CE ≥ 1.13 (Node.js 18.15 = 93,
 * TypeScript 5.0.3 = 94, Python 3.11.2 = 92). docs/12 §4 targets Node 22 /
 * Python 3.12 images — a self-hosted Judge0 with custom images will have its
 * own ids, so override with JUDGE0_LANGUAGE_IDS="javascript:93,typescript:94,python:92"
 * (check `GET /languages` on the Judge0 host).
 */
export const DEFAULT_JUDGE0_LANGUAGE_IDS: Readonly<
  Record<HarnessLanguage, number>
> = {
  javascript: 93,
  typescript: 94,
  python: 92,
};

export function parseJudge0LanguageIds(
  raw: string | undefined,
): Record<string, number> {
  const ids: Record<string, number> = { ...DEFAULT_JUDGE0_LANGUAGE_IDS };
  if (!raw?.trim()) return ids;
  for (const pair of raw.split(',')) {
    const [lang, id] = pair.split(/[:=]/).map((s) => s.trim());
    const n = Number(id);
    if (!lang || !Number.isInteger(n) || n <= 0)
      throw new Error(
        `JUDGE0_LANGUAGE_IDS: invalid entry "${pair}" (expected language:id)`,
      );
    if (!(lang in DEFAULT_JUDGE0_LANGUAGE_IDS))
      throw new Error(`JUDGE0_LANGUAGE_IDS: unsupported language "${lang}"`);
    ids[lang] = n;
  }
  return ids;
}

/** Judge0 status ids (GET /statuses). */
export const JUDGE0_STATUS = {
  IN_QUEUE: 1,
  PROCESSING: 2,
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TIME_LIMIT_EXCEEDED: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_SIGSEGV: 7,
  RUNTIME_SIGXFSZ: 8,
  RUNTIME_SIGFPE: 9,
  RUNTIME_SIGABRT: 10,
  RUNTIME_NZEC: 11,
  RUNTIME_OTHER: 12,
  INTERNAL_ERROR: 13,
  EXEC_FORMAT_ERROR: 14,
} as const;

export interface Judge0Result {
  token?: string;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  status?: { id: number; description?: string };
  time?: string | null;
  memory?: number | null;
}

const OOM_PATTERN =
  /MemoryError|heap out of memory|Allocation failed|Reached heap limit|Cannot allocate memory|bad_alloc/i;

/**
 * Map a finished Judge0 status to an execution error kind. `'infra'` means
 * the sandbox itself failed (not the student's fault). Exported for tests.
 */
export function mapJudge0Status(
  statusId: number,
  stderr: string,
  memoryKb: number | null | undefined,
  memoryLimitKb: number,
): ExecutionErrorKind | 'infra' {
  switch (statusId) {
    case JUDGE0_STATUS.ACCEPTED:
    case JUDGE0_STATUS.WRONG_ANSWER:
      return null;
    case JUDGE0_STATUS.TIME_LIMIT_EXCEEDED:
      return 'timeout';
    case JUDGE0_STATUS.COMPILATION_ERROR:
      return 'error';
    case JUDGE0_STATUS.RUNTIME_SIGSEGV:
    case JUDGE0_STATUS.RUNTIME_SIGXFSZ:
    case JUDGE0_STATUS.RUNTIME_SIGFPE:
    case JUDGE0_STATUS.RUNTIME_SIGABRT:
    case JUDGE0_STATUS.RUNTIME_NZEC:
    case JUDGE0_STATUS.RUNTIME_OTHER:
      if (
        OOM_PATTERN.test(stderr) ||
        (typeof memoryKb === 'number' && memoryKb >= memoryLimitKb * 0.95)
      )
        return 'memory';
      return 'runtime';
    default:
      return 'infra';
  }
}

export interface Judge0ExecutorOptions {
  baseUrl: string;
  authToken?: string;
  languageIds?: Record<string, number>;
  fetchImpl?: typeof fetch;
  /** Overall HTTP deadline per run, on top of the exercise's wall time. */
  requestTimeoutMs?: number;
  /** Poll interval when Judge0 does not honour `wait=true`. */
  pollIntervalMs?: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string | null | undefined) =>
  s ? Buffer.from(s, 'base64').toString('utf8') : '';

/**
 * Judge0 HTTP client (docs/12 §1, §5). One Judge0 submission per student
 * run: the generated harness executes every test in a single sandbox, so a
 * submit costs one isolate start-up (docs/12 §10 latency target). Limits:
 * cpu_time_limit ← timeLimitMs, memory_limit ← memoryLimitKb, wall 5s+,
 * network off, output capped by Judge0's max_file_size.
 */
export class Judge0Executor implements CodeExecutor {
  readonly mode = 'judge0' as const;
  readonly supportedLanguages: readonly string[];
  private readonly baseUrl: string;
  private readonly languageIds: Record<string, number>;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly opts: Judge0ExecutorOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.languageIds = opts.languageIds ?? { ...DEFAULT_JUDGE0_LANGUAGE_IDS };
    this.supportedLanguages = Object.keys(this.languageIds);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 20_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 250;
  }

  async run(req: RunRequest): Promise<RunResponse> {
    const languageId = this.languageIds[req.language];
    if (!languageId) {
      return {
        results: [],
        errorKind: 'error',
        runtimeMs: 0,
        output: `Language "${req.language}" is not configured on the code runner.`,
      };
    }
    const bundle = buildHarness({
      language: req.language as HarnessLanguage,
      code: req.code,
      entryFunction: req.entryFunction,
      tests: req.tests,
      testHarness: req.testHarness,
    });
    const cpuSeconds = Math.max(0.1, req.timeLimitMs / 1000);
    const body = {
      source_code: b64(bundle.source),
      language_id: languageId,
      stdin: b64(bundle.stdin),
      cpu_time_limit: cpuSeconds,
      cpu_extra_time: 0.5,
      wall_time_limit: Math.max(5, cpuSeconds * 2 + 1),
      memory_limit: req.memoryLimitKb,
      stack_limit: 64_000,
      max_processes_and_or_threads: 30,
      enable_network: false,
      redirect_stderr_to_stdout: false,
      number_of_runs: 1,
    };

    const deadline = Date.now() + this.requestTimeoutMs + req.timeLimitMs * 2;
    let result = await this.request<Judge0Result>(
      'POST',
      '/submissions?base64_encoded=true&wait=true',
      body,
      deadline,
    );
    // Judge0 with ENABLE_WAIT_RESULT=false (or a busy queue) returns a token only.
    while (
      !result.status ||
      result.status.id === JUDGE0_STATUS.IN_QUEUE ||
      result.status.id === JUDGE0_STATUS.PROCESSING
    ) {
      if (!result.token)
        throw new ExecutorUnavailableError(
          'Judge0 returned neither a result nor a token',
        );
      if (Date.now() > deadline)
        throw new ExecutorUnavailableError('Judge0 did not finish in time');
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const token = result.token;
      result = {
        token,
        ...(await this.request<Judge0Result>(
          'GET',
          `/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=token,stdout,stderr,compile_output,message,status,time,memory`,
          undefined,
          deadline,
        )),
      };
    }

    const stdout = unb64(result.stdout);
    const stderr = unb64(result.stderr);
    const compileOutput = unb64(result.compile_output);
    const kind = mapJudge0Status(
      result.status.id,
      stderr,
      result.memory,
      req.memoryLimitKb,
    );
    if (kind === 'infra') {
      throw new ExecutorUnavailableError(
        `Judge0 ${result.status.description ?? `status ${result.status.id}`}: ${unb64(result.message) || stderr}`.slice(
          0,
          500,
        ),
      );
    }

    const parsed = parseHarnessOutput(
      stdout,
      bundle.nonce,
      req.tests,
      bundle.trustPassed,
    );
    let errorKind: ExecutionErrorKind = kind;
    let output: string | undefined;
    switch (kind) {
      case 'error':
        output = cleanOutput(compileOutput || stderr);
        break;
      case 'timeout':
        output = `Your code ran longer than ${req.timeLimitMs} ms.`;
        break;
      case 'memory':
        output = `Your code used more than ${Math.round(req.memoryLimitKb / 1024)} MB of memory.`;
        break;
      case 'runtime':
        output =
          result.status.id === JUDGE0_STATUS.RUNTIME_SIGXFSZ
            ? 'Your code printed too much output.'
            : cleanOutput(stderr) ||
              `Runtime error (${result.status.description ?? result.status.id}).`;
        break;
      default:
        if (!parsed.complete) {
          errorKind = 'runtime';
          output =
            cleanOutput(stderr) || 'Your code exited before all tests ran.';
        }
    }
    const seconds = Number(result.time);
    return {
      results: parsed.results,
      errorKind,
      runtimeMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
      memoryKb: typeof result.memory === 'number' ? result.memory : undefined,
      output,
      studentOutput: parsed.studentOutput
        ? cleanOutput(parsed.studentOutput)
        : undefined,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    deadline: number,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.opts.authToken) headers['X-Auth-Token'] = this.opts.authToken;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
    } catch (err) {
      throw new ExecutorUnavailableError(
        `Judge0 unreachable: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ExecutorUnavailableError(
        `Judge0 HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }
}
