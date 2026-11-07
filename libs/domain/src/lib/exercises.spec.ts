import {
  allPassed,
  deepEqual,
  ENTRY_FUNCTION_PATTERN,
  EXERCISE_LANGUAGES,
  HIDDEN_TEST_FAILED_MESSAGE,
  isExerciseLanguage,
  redactHiddenResults,
  type StoredTestResult,
  scoreFromResults,
  verdictFromResults,
  type TestResult,
} from './exercises.js';

const r = (passed: boolean): TestResult => ({ id: 't', name: 't', passed });

describe('deepEqual', () => {
  it('primitives', () => {
    expect(deepEqual(3, 3)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(3, '3')).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
  it('arrays', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([[1], [2]], [[1], [2]])).toBe(true);
  });
  it('objects (key order independent)', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: [1, { x: 2 }] }, { a: [1, { x: 2 }] })).toBe(true);
  });
});

describe('scoreFromResults', () => {
  it('rounds passed/total to a percentage', () => {
    expect(scoreFromResults([r(true), r(true), r(true), r(false)])).toBe(75);
    expect(scoreFromResults([r(true), r(true), r(true)])).toBe(100);
    expect(scoreFromResults([r(false)])).toBe(0);
    expect(scoreFromResults([])).toBe(0);
  });
});

describe('allPassed', () => {
  it('true only when non-empty and all pass', () => {
    expect(allPassed([r(true), r(true)])).toBe(true);
    expect(allPassed([r(true), r(false)])).toBe(false);
    expect(allPassed([])).toBe(false);
  });
});

describe('verdictFromResults', () => {
  it('PASS / FAIL from tests', () => {
    expect(verdictFromResults([r(true), r(true)])).toBe('PASS');
    expect(verdictFromResults([r(true), r(false)])).toBe('FAIL');
  });
  it('execution errors override test outcome', () => {
    expect(verdictFromResults([r(true)], 'timeout')).toBe('TIMEOUT');
    expect(verdictFromResults([r(true)], 'runtime')).toBe('RUNTIME');
    expect(verdictFromResults([], 'error')).toBe('ERROR');
    expect(verdictFromResults([r(true)], 'memory')).toBe('MEMORY');
  });
});

describe('languages + entry function', () => {
  it('whitelists javascript, typescript and python only', () => {
    expect(EXERCISE_LANGUAGES).toEqual(['javascript', 'typescript', 'python']);
    expect(isExerciseLanguage('python')).toBe(true);
    expect(isExerciseLanguage('ruby')).toBe(false);
  });
  it('entry function must be a plain identifier', () => {
    expect(ENTRY_FUNCTION_PATTERN.test('two_sum')).toBe(true);
    expect(ENTRY_FUNCTION_PATTERN.test('a); process.exit(')).toBe(false);
    expect(ENTRY_FUNCTION_PATTERN.test('1abc')).toBe(false);
  });
});

describe('redactHiddenResults', () => {
  const results: StoredTestResult[] = [
    {
      id: 'v1',
      name: 'visible',
      passed: false,
      actual: 1,
      expected: 2,
      hidden: false,
    },
    {
      id: 'h-negatives',
      name: 'negative numbers',
      passed: false,
      actual: -1,
      expected: 3,
      error: 'boom: secret arg 42',
      hidden: true,
    },
    { id: 'h-empty', name: 'empty list', passed: true, hidden: true },
  ];

  it('keeps visible diffs but strips everything but pass/fail from hidden tests', () => {
    const out = redactHiddenResults(results, false);
    expect(out[0]).toEqual({
      id: 'v1',
      name: 'visible',
      passed: false,
      actual: 1,
      expected: 2,
    });
    expect(out[1]).toEqual({
      id: 'hidden-1',
      name: 'Hidden test 1',
      passed: false,
      hidden: true,
      error: HIDDEN_TEST_FAILED_MESSAGE,
    });
    expect(out[2]).toEqual({
      id: 'hidden-2',
      name: 'Hidden test 2',
      passed: true,
      hidden: true,
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('negative numbers');
    expect(out[1]).not.toHaveProperty('actual');
    expect(out[1]).not.toHaveProperty('expected');
  });

  it('reveals hidden names (only) on a full pass', () => {
    const passing = results.map((x) => ({
      id: x.id,
      name: x.name,
      hidden: x.hidden,
      passed: true,
    }));
    expect(redactHiddenResults(passing, true)[1]).toEqual({
      id: 'h-negatives',
      name: 'negative numbers',
      passed: true,
      hidden: true,
    });
  });
});
