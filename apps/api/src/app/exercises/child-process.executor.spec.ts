import { ChildProcessExecutor } from './child-process.executor.js';
import type { RunRequest } from './executor.types.js';

jest.setTimeout(30_000);

const base: Omit<RunRequest, 'code'> = {
  language: 'javascript',
  entryFunction: 'solution',
  tests: [
    { id: 't1', name: '1 + 2', args: [1, 2], expected: 3 },
    { id: 't2', name: '-4 + 1', args: [-4, 1], expected: -3 },
  ],
  timeLimitMs: 2000,
  memoryLimitKb: 128_000,
};

describe('ChildProcessExecutor', () => {
  const executor = new ChildProcessExecutor({ startupGraceMs: 2000 });

  it('runs a correct solution and passes every test', async () => {
    const res = await executor.run({
      ...base,
      code: 'function solution(a, b) { return a + b; }',
    });
    expect(res.errorKind).toBeNull();
    expect(res.results.map((r) => r.passed)).toEqual([true, true]);
  });

  it('reports actual vs expected for a wrong answer and keeps student prints out of results', async () => {
    const res = await executor.run({
      ...base,
      code: 'function solution(a, b) { console.log("debug", a, b); return a - b; }',
    });
    expect(res.errorKind).toBeNull();
    expect(res.results[0]).toMatchObject({
      id: 't1',
      passed: false,
      actual: -1,
      expected: 3,
    });
    expect(res.studentOutput).toContain('debug 1 2');
  });

  it('awaits async solutions', async () => {
    const res = await executor.run({
      ...base,
      code: 'async function solution(a, b) { await null; return a + b; }',
    });
    expect(res.results.every((r) => r.passed)).toBe(true);
  });

  it('captures per-test exceptions without failing the whole run', async () => {
    const res = await executor.run({
      ...base,
      code: 'function solution(a) { if (a < 0) throw new Error("negative!"); return 3; }',
    });
    expect(res.errorKind).toBeNull();
    expect(res.results[0].passed).toBe(true);
    expect(res.results[1]).toMatchObject({ passed: false, error: 'negative!' });
  });

  it('kills an infinite loop at the wall-clock limit (TIMEOUT)', async () => {
    const started = Date.now();
    const res = await executor.run({
      ...base,
      timeLimitMs: 300,
      code: 'function solution() { for (;;) {} }',
    });
    expect(res.errorKind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('caps memory with --max-old-space-size (MEMORY)', async () => {
    const res = await executor.run({
      ...base,
      memoryLimitKb: 32_000,
      timeLimitMs: 8000,
      code: 'function solution() { const keep = []; for (;;) keep.push(new Array(1e5).fill({ x: Math.random() })); }',
    });
    expect(res.errorKind).toBe('memory');
  });

  it('kills runaway output', async () => {
    const res = await executor.run({
      ...base,
      code: 'function solution() { for (;;) process.stdout.write("x".repeat(10000)); }',
    });
    expect(res.errorKind).toBe('runtime');
    expect(res.output).toMatch(/too much output/);
  });

  it('reports a syntax error as a runtime error with the diagnostic', async () => {
    const res = await executor.run({ ...base, code: 'function solution( {' });
    expect(res.errorKind).toBe('runtime');
    expect(res.output).toMatch(/SyntaxError/);
  });

  it('runs TypeScript by stripping types', async () => {
    if (!executor.supportedLanguages.includes('typescript')) return;
    const res = await executor.run({
      ...base,
      language: 'typescript',
      code: 'function solution(a: number, b: number): number { return a + b; }',
    });
    expect(res.errorKind).toBeNull();
    expect(res.results.every((r) => r.passed)).toBe(true);
  });

  it('refuses languages it cannot run', async () => {
    const res = await executor.run({
      ...base,
      language: 'python',
      code: 'def solution(a, b): return a + b',
    });
    expect(res.errorKind).toBe('error');
    expect(res.output).toMatch(/JUDGE0_URL/);
  });

  describe('sandbox escape regression (old node:vm executor)', () => {
    const SECRET = 'codify-test-secret-' + Math.random().toString(36).slice(2);
    beforeAll(() => {
      process.env['CODIFY_EXECUTOR_TEST_SECRET'] = SECRET;
    });
    afterAll(() => {
      delete process.env['CODIFY_EXECUTOR_TEST_SECRET'];
    });

    it('the constructor.constructor escape does not reach the API process environment', async () => {
      // The vm executor exposed `__tests`; this reached the host `process`.
      const res = await executor.run({
        ...base,
        tests: [{ id: 'leak', name: 'leak', args: [], expected: 'nothing' }],
        code: `function solution() {
          const p = ({}).constructor.constructor('return process')();
          return JSON.stringify({ env: p.env, keys: Object.keys(p.env), pid: p.pid, ppid: p.ppid });
        }`,
      });
      const actual = String(res.results[0].actual);
      expect(actual).not.toContain(SECRET);
      expect(JSON.parse(actual).keys).toEqual([]);
      expect(JSON.parse(actual).pid).not.toBe(process.pid);
    });

    it('cannot read the parent process environment through /proc or spawn processes', async () => {
      const res = await executor.run({
        ...base,
        tests: [{ id: 'leak', name: 'leak', args: [], expected: 'nothing' }],
        code: `function solution() {
          const out = [];
          try { out.push(require('fs').readFileSync('/proc/' + process.ppid + '/environ', 'utf8')); } catch (e) { out.push('fs:' + e.code); }
          try { out.push(String(require('child_process').execSync('env'))); } catch (e) { out.push('cp:' + e.code); }
          return out.join('|');
        }`,
      });
      const actual = String(res.results[0].actual);
      expect(actual).not.toContain(SECRET);
      expect(actual).toContain('ERR_ACCESS_DENIED');
    });
  });
});
