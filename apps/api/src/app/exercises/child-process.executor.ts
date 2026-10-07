import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionErrorKind } from '@codify/domain';
import {
  buildHarness,
  cleanOutput,
  parseHarnessOutput,
  type HarnessLanguage,
} from './harness.js';
import type {
  CodeExecutor,
  RunRequest,
  RunResponse,
} from './executor.types.js';

export interface ChildProcessExecutorOptions {
  /** Node binary (defaults to the running one). */
  nodePath?: string;
  /** Hard cap on captured stdout; the process is killed beyond it. */
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  /** Extra wall-clock allowance on top of timeLimitMs for Node start-up. */
  startupGraceMs?: number;
}

const flags = process.allowedNodeEnvironmentFlags;
/** Node's permission model: `--permission` (22.13+) or the older experimental flag. */
const PERMISSION_FLAG = flags.has('--permission')
  ? '--permission'
  : flags.has('--experimental-permission')
    ? '--experimental-permission'
    : null;
const CAN_STRIP_TYPES = flags.has('--experimental-strip-types');

/**
 * Dev-only executor: runs the generated harness in a SEPARATE Node process.
 *
 *   - empty environment (no API secrets, no DATABASE_URL, …)
 *   - Node permission model: fs reads limited to its own temp dir, no fs
 *     writes, no child processes / workers / native addons
 *   - `--max-old-space-size` from memoryLimitKb
 *   - wall-clock SIGKILL at timeLimitMs (+ start-up grace)
 *   - stdout capped (killed beyond the cap), stderr truncated
 *   - cwd = a fresh temp dir, removed afterwards
 *   - results come back over stdout with the nonce protocol (harness.ts)
 *
 * It replaces the old in-process `node:vm` executor, which was escapable
 * (`__tests.constructor.constructor('return process')()` reached the API's
 * process and env). Network access is not restricted by Node's permission
 * model — production must use Judge0.
 */
export class ChildProcessExecutor implements CodeExecutor {
  readonly mode = 'dev' as const;
  readonly supportedLanguages: readonly string[];
  private readonly nodePath: string;
  private readonly maxStdout: number;
  private readonly maxStderr: number;
  private readonly grace: number;

  constructor(opts: ChildProcessExecutorOptions = {}) {
    this.nodePath = opts.nodePath ?? process.execPath;
    this.maxStdout = opts.maxStdoutBytes ?? 64 * 1024;
    this.maxStderr = opts.maxStderrBytes ?? 16 * 1024;
    this.grace = opts.startupGraceMs ?? 1500;
    this.supportedLanguages = CAN_STRIP_TYPES
      ? ['javascript', 'typescript']
      : ['javascript'];
  }

  async run(req: RunRequest): Promise<RunResponse> {
    if (!this.supportedLanguages.includes(req.language)) {
      return {
        results: [],
        errorKind: 'error',
        runtimeMs: 0,
        output: `The local executor cannot run ${req.language}. Configure JUDGE0_URL to run it.`,
      };
    }
    const bundle = buildHarness({
      language: req.language as HarnessLanguage,
      code: req.code,
      entryFunction: req.entryFunction,
      tests: req.tests,
      testHarness: req.testHarness,
    });

    const dir = await mkdtemp(join(tmpdir(), 'codify-run-'));
    const file = join(dir, `main.${bundle.fileExt}`);
    try {
      await writeFile(file, bundle.source, 'utf8');
      const heapMb = Math.max(16, Math.ceil(req.memoryLimitKb / 1024));
      const args = [
        ...(PERMISSION_FLAG ? [PERMISSION_FLAG, `--allow-fs-read=${dir}`] : []),
        `--max-old-space-size=${heapMb}`,
        '--disable-warning=ExperimentalWarning',
        ...(bundle.fileExt === 'ts' ? ['--experimental-strip-types'] : []),
        file,
      ];
      const proc = await this.spawnCapped(
        args,
        dir,
        bundle.stdin,
        req.timeLimitMs + this.grace,
      );

      const parsed = parseHarnessOutput(
        proc.stdout,
        bundle.nonce,
        req.tests,
        bundle.trustPassed,
      );
      let errorKind: ExecutionErrorKind = null;
      let output: string | undefined;
      if (proc.timedOut) {
        errorKind = 'timeout';
        output = `Your code ran longer than ${req.timeLimitMs} ms.`;
      } else if (
        /heap out of memory|Allocation failed|Reached heap limit/i.test(
          proc.stderr,
        )
      ) {
        errorKind = 'memory';
        output = `Your code used more than ${Math.round(req.memoryLimitKb / 1024)} MB of memory.`;
      } else if (proc.outputCapped) {
        errorKind = 'runtime';
        output = 'Your code printed too much output.';
      } else if (!parsed.complete) {
        errorKind = 'runtime';
        output =
          cleanOutput(proc.stderr) ||
          `Your code exited (code ${proc.exitCode ?? proc.signal}) before all tests ran.`;
      }
      return {
        results: parsed.results,
        errorKind,
        runtimeMs: proc.wallMs,
        output,
        studentOutput: parsed.studentOutput
          ? cleanOutput(parsed.studentOutput)
          : undefined,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private spawnCapped(
    args: string[],
    cwd: string,
    stdin: string,
    wallMs: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    outputCapped: boolean;
    wallMs: number;
  }> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(this.nodePath, args, {
        cwd,
        env: {},
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let timedOut = false;
      let outputCapped = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, wallMs);

      child.stdout.on('data', (chunk: Buffer) => {
        outBytes += chunk.length;
        if (outBytes > this.maxStdout) {
          outputCapped = true;
          child.kill('SIGKILL');
          return;
        }
        out.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (errBytes < this.maxStderr)
          err.push(chunk.subarray(0, this.maxStderr - errBytes));
        errBytes += chunk.length;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          exitCode,
          signal,
          timedOut,
          outputCapped,
          wallMs: Date.now() - started,
        });
      });
      // The child may exit before reading stdin; ignore EPIPE.
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    });
  }
}
