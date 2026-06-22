import {
  allPassed,
  deepEqual,
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
