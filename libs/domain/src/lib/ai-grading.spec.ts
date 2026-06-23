import {
  gradeDeterministicCriterion,
  isLlmCriterion,
  scoreRubric,
  type CriterionResult,
  type RubricCriterion,
} from './ai-grading.js';

describe('gradeDeterministicCriterion', () => {
  it('keyword: requires ALL listed terms (case-insensitive)', () => {
    const c: RubricCriterion = { id: 'a', label: 'mentions try/catch', weight: 1, kind: 'keyword', config: { all: ['try', 'catch'] } };
    expect(gradeDeterministicCriterion('Use a TRY / CATCH block', c)?.passed).toBe(true);
    const miss = gradeDeterministicCriterion('just try it', c);
    expect(miss?.passed).toBe(false);
    expect(miss?.detail).toContain('catch');
  });

  it('keyword: ANY passes if at least one present', () => {
    const c: RubricCriterion = { id: 'a', label: 'greeting', weight: 1, kind: 'keyword', config: { any: ['hello', 'hi', 'olá'] } };
    expect(gradeDeterministicCriterion('Hi there', c)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('goodbye', c)?.passed).toBe(false);
  });

  it('regex: matches with default case-insensitive flag', () => {
    const c: RubricCriterion = { id: 'r', label: 'has a number', weight: 1, kind: 'regex', config: { pattern: '\\d+' } };
    expect(gradeDeterministicCriterion('abc 42', c)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('no digits', c)?.passed).toBe(false);
  });

  it('regex: invalid pattern fails closed', () => {
    const c: RubricCriterion = { id: 'r', label: 'bad', weight: 1, kind: 'regex', config: { pattern: '(' } };
    expect(gradeDeterministicCriterion('anything', c)?.passed).toBe(false);
  });

  it('minWords / maxWords count words', () => {
    const min: RubricCriterion = { id: 'm', label: 'min', weight: 1, kind: 'minWords', config: { min: 3 } };
    expect(gradeDeterministicCriterion('one two three', min)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('too short', min)?.passed).toBe(false);
    const max: RubricCriterion = { id: 'x', label: 'max', weight: 1, kind: 'maxWords', config: { max: 2 } };
    expect(gradeDeterministicCriterion('one two', max)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('one two three', max)?.passed).toBe(false);
  });

  it('returns null for llm criteria (provider grades those)', () => {
    const c: RubricCriterion = { id: 'l', label: 'tone', weight: 1, kind: 'llm', config: { concepts: ['empathy'] } };
    expect(gradeDeterministicCriterion('text', c)).toBeNull();
    expect(isLlmCriterion(c)).toBe(true);
  });
});

describe('scoreRubric', () => {
  const r = (id: string, weight: number, passed: boolean): CriterionResult => ({ id, label: id, weight, passed });

  it('weighted fraction → percent + pass threshold', () => {
    const results = [r('a', 2, true), r('b', 1, false), r('c', 1, true)]; // earned 3 / total 4 = 75%
    const g = scoreRubric(results, 70);
    expect(g.scorePct).toBe(75);
    expect(g.passed).toBe(true);
  });

  it('below threshold does not pass', () => {
    const g = scoreRubric([r('a', 1, true), r('b', 1, false)], 70); // 50%
    expect(g.scorePct).toBe(50);
    expect(g.passed).toBe(false);
  });

  it('empty rubric scores 0, never passes a positive threshold', () => {
    const g = scoreRubric([], 1);
    expect(g.scorePct).toBe(0);
    expect(g.passed).toBe(false);
  });

  it('negative weights are clamped to 0', () => {
    const g = scoreRubric([r('a', -5, true), r('b', 1, true)], 100);
    expect(g.scorePct).toBe(100);
  });
});
