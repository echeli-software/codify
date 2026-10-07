import {
  buildHarness,
  cleanOutput,
  makeNonce,
  parseHarnessOutput,
} from './harness.js';

const tests = [
  { id: 't1', name: 'adds', args: [1, 2], expected: 3 },
  { id: 'h1', name: 'hidden', args: [[1, 2]], expected: [2, 1] },
];

describe('buildHarness', () => {
  it('sends args + nonce on stdin and never the expected values', () => {
    const b = buildHarness(
      {
        language: 'javascript',
        code: 'function solution(){}',
        entryFunction: 'solution',
        tests,
      },
      'N0NCE',
    );
    expect(JSON.parse(b.stdin)).toEqual({
      nonce: 'N0NCE',
      tests: [
        { id: 't1', args: [1, 2] },
        { id: 'h1', args: [[1, 2]] },
      ],
    });
    expect(b.stdin).not.toContain('expected');
    expect(b.source).not.toContain('N0NCE');
    expect(b.source).not.toContain('[2,1]');
    expect(b.trustPassed).toBe(false);
  });

  it('puts the prelude on one line so student line numbers shift by one', () => {
    for (const language of ['javascript', 'typescript', 'python'] as const) {
      const b = buildHarness({
        language,
        code: 'LINE_ONE\nLINE_TWO',
        entryFunction: 'solution',
        tests,
      });
      const lines = b.source.split('\n');
      expect(lines[1]).toBe('LINE_ONE');
      expect(lines[2]).toBe('LINE_TWO');
    }
  });

  it('uses typings-free constructs for TypeScript', () => {
    const b = buildHarness({
      language: 'typescript',
      code: '',
      entryFunction: 'solve',
      tests,
    });
    expect(b.fileExt).toBe('ts');
    expect(b.source).toContain("eval('require')");
    expect(b.source).not.toMatch(/\basync\b|\bawait\b/);
  });

  it('python prelude runs in its own namespace via exec', () => {
    const b = buildHarness({
      language: 'python',
      code: 'def solve(x): return x',
      entryFunction: 'solve',
      tests,
    });
    expect(b.fileExt).toBe('py');
    expect(b.source.split('\n')[0]).toMatch(
      /^__codify_run = \(lambda __s, __g: \(exec\(__s, __g\)/,
    );
    expect(b.source.trim().split('\n').pop()).toBe(
      '__codify_run(globals().get("solve"))',
    );
  });

  it('uses a custom harness verbatim after student code and trusts its passed flag', () => {
    const b = buildHarness({
      language: 'python',
      code: 'x = 1',
      entryFunction: 'solve',
      tests,
      testHarness: 'print("custom")',
    });
    expect(b.source).toBe('x = 1\nprint("custom")\n');
    expect(b.trustPassed).toBe(true);
  });

  it('rejects entry functions that are not identifiers (source injection)', () => {
    expect(() =>
      buildHarness({
        language: 'javascript',
        code: '',
        entryFunction: 'x); process.exit(1); (',
        tests,
      }),
    ).toThrow(/Invalid entry function/);
  });

  it('nonces are random and delimited', () => {
    const a = makeNonce();
    expect(a).toMatch(/^@@codify:[0-9a-f]{32}@@$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe('parseHarnessOutput', () => {
  const N = '@@codify:abc@@';
  const line = (o: unknown) => `${N}${JSON.stringify(o)}`;

  it('compares actual host-side and separates student output', () => {
    const out = [
      'hello from student',
      line({ id: 't1', actual: 3, runtimeMs: 1 }),
      line({ id: 'h1', actual: [1, 2] }),
    ].join('\n');
    const p = parseHarnessOutput(out, N, tests, false);
    expect(p.complete).toBe(true);
    expect(p.results[0]).toEqual({
      id: 't1',
      name: 'adds',
      passed: true,
      runtimeMs: 1,
    });
    expect(p.results[1]).toMatchObject({
      id: 'h1',
      passed: false,
      actual: [1, 2],
      expected: [2, 1],
    });
    expect(p.studentOutput).toBe('hello from student');
  });

  it('ignores un-nonced lines that imitate results (spoofing)', () => {
    const out = [
      JSON.stringify({ id: 't1', actual: 3 }),
      '@@codify:wrong@@{"id":"t1","actual":3}',
    ].join('\n');
    const p = parseHarnessOutput(out, N, tests, false);
    expect(p.results[0]).toMatchObject({
      passed: false,
      error: 'Test did not finish',
    });
    expect(p.complete).toBe(false);
  });

  it('never trusts a `passed` flag from the generated harness', () => {
    const p = parseHarnessOutput(
      line({ id: 'h1', passed: true, actual: 'nope' }),
      N,
      tests,
      false,
    );
    expect(p.results[1].passed).toBe(false);
  });

  it('trusts `passed` from a custom harness', () => {
    const p = parseHarnessOutput(
      line({ id: 'h1', passed: true }),
      N,
      tests,
      true,
    );
    expect(p.results[1].passed).toBe(true);
  });

  it('flags duplicated result lines as tampering', () => {
    const out = [
      line({ id: 't1', actual: 3 }),
      line({ id: 't1', actual: 3 }),
    ].join('\n');
    const p = parseHarnessOutput(out, N, tests, false);
    expect(p.results[0]).toMatchObject({
      passed: false,
      error: expect.stringMatching(/More than one result/),
    });
  });

  it('accepts a result line glued to a partial student print', () => {
    const p = parseHarnessOutput(
      `partial${line({ id: 't1', actual: 3 })}`,
      N,
      tests,
      false,
    );
    expect(p.results[0].passed).toBe(true);
    expect(p.studentOutput).toBe('partial');
  });

  it('maps errors and the undefined marker', () => {
    const out = [
      line({ id: 't1', error: 'boom' }),
      line({ id: 'h1', actual: null, undef: true }),
    ].join('\n');
    const p = parseHarnessOutput(
      out,
      N,
      [tests[0], { id: 'h1', name: 'h', args: [], expected: undefined }],
      false,
    );
    expect(p.results[0]).toMatchObject({ passed: false, error: 'boom' });
    expect(p.results[1].passed).toBe(true);
  });
});

describe('cleanOutput', () => {
  it('strips ANSI escapes and truncates', () => {
    expect(cleanOutput('\u001b[31mred\u001b[0m')).toBe('red');
    expect(cleanOutput('x'.repeat(50), 10)).toBe('xxxxxxxxxx\n… (truncated)');
  });
});
