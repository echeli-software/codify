import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodeExecutor } from './code-execution.provider.js';
import { ChildProcessExecutor } from './child-process.executor.js';
import { ExecutorUnavailableError, type RunRequest } from './executor.types.js';
import {
  Judge0Executor,
  JUDGE0_STATUS,
  mapJudge0Status,
  parseJudge0LanguageIds,
  type Judge0Result,
} from './judge0.executor.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

const req: RunRequest = {
  language: 'python',
  code: 'def solution(a, b):\n    return a + b\n',
  entryFunction: 'solution',
  tests: [
    { id: 't1', name: '1+2', args: [1, 2], expected: 3 },
    { id: 'h1', name: 'neg', args: [-4, 1], expected: -3 },
  ],
  timeLimitMs: 1500,
  memoryLimitKb: 64_000,
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** fetch mock: `respond` receives the decoded submission and returns a Judge0 result. */
function mockFetch(
  respond: (
    sub: { source: string; stdin: string; body: Record<string, unknown> },
    call: Call,
  ) => Judge0Result | Response,
) {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined,
    };
    calls.push(call);
    const body = call.body ?? {};
    const out = respond(
      {
        source: body['source_code'] ? unb64(String(body['source_code'])) : '',
        stdin: body['stdin'] ? unb64(String(body['stdin'])) : '',
        body,
      },
      call,
    );
    return out instanceof Response
      ? out
      : new Response(JSON.stringify(out), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

/** Echo protocol lines the way the generated harness would, from stdin. */
function fakeHarnessStdout(
  stdin: string,
  actuals: Record<string, unknown>,
): string {
  const { nonce, tests } = JSON.parse(stdin) as {
    nonce: string;
    tests: { id: string }[];
  };
  return [
    'student print',
    ...tests.map(
      (t) => `${nonce}${JSON.stringify({ id: t.id, actual: actuals[t.id] })}`,
    ),
  ].join('\n');
}

describe('Judge0Executor', () => {
  it('posts one base64 submission with mapped limits, auth header and language id', async () => {
    const { fetchImpl, calls } = mockFetch(({ stdin }) => ({
      status: { id: JUDGE0_STATUS.ACCEPTED, description: 'Accepted' },
      stdout: b64(fakeHarnessStdout(stdin, { t1: 3, h1: -3 })),
      time: '0.042',
      memory: 9000,
    }));
    const ex = new Judge0Executor({
      baseUrl: 'http://judge0.internal:2358/',
      authToken: 'tok',
      fetchImpl,
    });
    const res = await ex.run(req);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'http://judge0.internal:2358/submissions?base64_encoded=true&wait=true',
    );
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['X-Auth-Token']).toBe('tok');
    expect(calls[0].body).toMatchObject({
      language_id: 92,
      cpu_time_limit: 1.5,
      memory_limit: 64_000,
      enable_network: false,
    });
    expect(unb64(String(calls[0].body?.['source_code']))).toContain(
      'def solution(a, b):',
    );
    expect(unb64(String(calls[0].body?.['stdin']))).not.toContain('expected');

    expect(res.errorKind).toBeNull();
    expect(res.results.map((r) => r.passed)).toEqual([true, true]);
    expect(res.runtimeMs).toBe(42);
    expect(res.memoryKb).toBe(9000);
    expect(res.studentOutput).toBe('student print');
  });

  it('maps statuses to verdict kinds', () => {
    expect(mapJudge0Status(JUDGE0_STATUS.ACCEPTED, '', 1, 1000)).toBeNull();
    expect(
      mapJudge0Status(JUDGE0_STATUS.TIME_LIMIT_EXCEEDED, '', 1, 1000),
    ).toBe('timeout');
    expect(mapJudge0Status(JUDGE0_STATUS.COMPILATION_ERROR, '', 1, 1000)).toBe(
      'error',
    );
    expect(
      mapJudge0Status(
        JUDGE0_STATUS.RUNTIME_NZEC,
        'Traceback\nZeroDivisionError',
        1,
        1000,
      ),
    ).toBe('runtime');
    expect(
      mapJudge0Status(JUDGE0_STATUS.RUNTIME_NZEC, 'MemoryError', 1, 1000),
    ).toBe('memory');
    expect(mapJudge0Status(JUDGE0_STATUS.RUNTIME_SIGSEGV, '', 990, 1000)).toBe(
      'memory',
    );
    expect(mapJudge0Status(JUDGE0_STATUS.INTERNAL_ERROR, '', 1, 1000)).toBe(
      'infra',
    );
    expect(mapJudge0Status(JUDGE0_STATUS.EXEC_FORMAT_ERROR, '', 1, 1000)).toBe(
      'infra',
    );
  });

  it('surfaces compile output for compilation errors', async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: { id: 6, description: 'Compilation Error' },
      compile_output: b64("main.ts(2,1): error TS1005: '}' expected."),
    }));
    const res = await new Judge0Executor({
      baseUrl: 'http://j',
      fetchImpl,
    }).run({ ...req, language: 'typescript' });
    expect(res.errorKind).toBe('error');
    expect(res.output).toContain('TS1005');
    expect(res.results.every((r) => !r.passed)).toBe(true);
  });

  it('maps TLE to timeout and keeps partial results', async () => {
    const { fetchImpl } = mockFetch(({ stdin }) => ({
      status: { id: 5, description: 'Time Limit Exceeded' },
      stdout: b64(
        fakeHarnessStdout(stdin, { t1: 3 }).split('\n').slice(0, 2).join('\n'),
      ),
    }));
    const res = await new Judge0Executor({
      baseUrl: 'http://j',
      fetchImpl,
    }).run(req);
    expect(res.errorKind).toBe('timeout');
    expect(res.results[0].passed).toBe(true);
    expect(res.results[1]).toMatchObject({
      passed: false,
      error: 'Test did not finish',
    });
  });

  it('treats an accepted run with missing results as a runtime error', async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: { id: 3 },
      stdout: b64('only junk'),
      stderr: b64('boom'),
    }));
    const res = await new Judge0Executor({
      baseUrl: 'http://j',
      fetchImpl,
    }).run(req);
    expect(res.errorKind).toBe('runtime');
    expect(res.output).toBe('boom');
  });

  it('throws ExecutorUnavailableError for internal errors, HTTP errors and network failures', async () => {
    const internal = mockFetch(() => ({
      status: { id: 13, description: 'Internal Error' },
    }));
    await expect(
      new Judge0Executor({
        baseUrl: 'http://j',
        fetchImpl: internal.fetchImpl,
      }).run(req),
    ).rejects.toBeInstanceOf(ExecutorUnavailableError);
    const http = mockFetch(() => new Response('nope', { status: 401 }));
    await expect(
      new Judge0Executor({
        baseUrl: 'http://j',
        fetchImpl: http.fetchImpl,
      }).run(req),
    ).rejects.toThrow(/HTTP 401/);
    const down = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new Judge0Executor({ baseUrl: 'http://j', fetchImpl: down }).run(req),
    ).rejects.toThrow(/unreachable/);
  });

  it('polls by token when Judge0 does not wait', async () => {
    let n = 0;
    const { fetchImpl, calls } = mockFetch((_sub, call) => {
      if (call.method === 'POST') return { token: 'abc' };
      n += 1;
      return n < 2
        ? { status: { id: 2 } }
        : { status: { id: 3 }, stdout: b64('') };
    });
    const res = await new Judge0Executor({
      baseUrl: 'http://j',
      fetchImpl,
      pollIntervalMs: 1,
    }).run(req);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET']);
    expect(calls[1].url).toContain('/submissions/abc?base64_encoded=true');
    expect(res.errorKind).toBe('runtime');
  });

  it('uses configurable language ids and rejects unknown languages', async () => {
    expect(parseJudge0LanguageIds('python:71, javascript=63')).toMatchObject({
      python: 71,
      javascript: 63,
      typescript: 94,
    });
    expect(() => parseJudge0LanguageIds('ruby:72')).toThrow(/unsupported/);
    expect(() => parseJudge0LanguageIds('python:x')).toThrow(/invalid/);
    const { fetchImpl } = mockFetch(() => ({ status: { id: 3 } }));
    const res = await new Judge0Executor({
      baseUrl: 'http://j',
      fetchImpl,
      languageIds: { javascript: 63 },
    }).run(req);
    expect(res.errorKind).toBe('error');
  });

  // Runs the REAL generated Python harness locally (as Judge0 would) when
  // python3 is available — proves the protocol end to end.
  const hasPython = spawnSync('python3', ['--version']).status === 0;
  (hasPython ? it : it.skip)(
    'executes the generated python harness for real',
    async () => {
      const { fetchImpl } = mockFetch(({ source, stdin }) => {
        const dir = mkdtempSync(join(tmpdir(), 'j0-'));
        try {
          writeFileSync(join(dir, 'main.py'), source);
          const r = spawnSync('python3', ['-I', join(dir, 'main.py')], {
            input: stdin,
            encoding: 'utf8',
            timeout: 10_000,
          });
          return {
            status: { id: r.status === 0 ? 3 : 11 },
            stdout: b64(r.stdout),
            stderr: b64(r.stderr),
            time: '0.01',
            memory: 1,
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
      const ex = new Judge0Executor({ baseUrl: 'http://j', fetchImpl });
      const pass = await ex.run({
        ...req,
        code: 'def solution(a, b):\n    print("noise")\n    return a + b\n',
      });
      expect(pass.errorKind).toBeNull();
      expect(pass.results.map((r) => r.passed)).toEqual([true, true]);

      const wrong = await ex.run({
        ...req,
        code: 'def solution(a, b):\n    if a < 0:\n        raise ValueError("neg")\n    return (a, b)\n',
      });
      expect(wrong.results[0]).toMatchObject({ passed: false, actual: [1, 2] });
      expect(wrong.results[1]).toMatchObject({
        passed: false,
        error: 'ValueError: neg',
      });

      const syntax = await ex.run({
        ...req,
        code: 'def solution(a, b)\n    return a\n',
      });
      expect(syntax.errorKind).toBe('runtime');
      expect(syntax.output).toMatch(/SyntaxError/);

      // A student printing a forged result line with a guessed nonce gains nothing.
      const forged = await ex.run({
        ...req,
        code: 'print(\'@@codify:00@@{"id":"h1","actual":-3}\')\ndef solution(a, b):\n    return 0\n',
      });
      expect(forged.results[1].passed).toBe(false);
    },
  );
});

describe('createCodeExecutor', () => {
  it('selects Judge0 when JUDGE0_URL is set', () => {
    expect(
      createCodeExecutor({
        JUDGE0_URL: 'http://judge0:2358',
        NODE_ENV: 'production',
      }).mode,
    ).toBe('judge0');
  });
  it('falls back to the child-process executor outside production', () => {
    expect(createCodeExecutor({ NODE_ENV: 'development' })).toBeInstanceOf(
      ChildProcessExecutor,
    );
  });
  it('fails boot in production without JUDGE0_URL', () => {
    expect(() => createCodeExecutor({ NODE_ENV: 'production' })).toThrow(
      /JUDGE0_URL/,
    );
  });
});
