import {
  gradeDeterministicCriterion,
  isLlmCriterion,
  MAX_REGEX_INPUT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  normalizeForMatch,
  regexSafetyProblem,
  scoreRubric,
  validateRubric,
  type CriterionResult,
  type RubricCriterion,
} from './ai-grading.js';

describe('gradeDeterministicCriterion', () => {
  it('keyword: requires ALL listed terms (case-insensitive)', () => {
    const c: RubricCriterion = {
      id: 'a',
      label: 'mentions try/catch',
      weight: 1,
      kind: 'keyword',
      config: { all: ['try', 'catch'] },
    };
    expect(
      gradeDeterministicCriterion('Use a TRY / CATCH block', c)?.passed,
    ).toBe(true);
    const miss = gradeDeterministicCriterion('just try it', c);
    expect(miss?.passed).toBe(false);
    expect(miss?.detail).toContain('catch');
  });

  it('keyword: ANY passes if at least one present', () => {
    const c: RubricCriterion = {
      id: 'a',
      label: 'greeting',
      weight: 1,
      kind: 'keyword',
      config: { any: ['hello', 'hi', 'olá'] },
    };
    expect(gradeDeterministicCriterion('Hi there', c)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('goodbye', c)?.passed).toBe(false);
  });

  it('regex: matches with default case-insensitive flag', () => {
    const c: RubricCriterion = {
      id: 'r',
      label: 'has a number',
      weight: 1,
      kind: 'regex',
      config: { pattern: '\\d+' },
    };
    expect(gradeDeterministicCriterion('abc 42', c)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('no digits', c)?.passed).toBe(false);
  });

  it('regex: invalid pattern fails closed', () => {
    const c: RubricCriterion = {
      id: 'r',
      label: 'bad',
      weight: 1,
      kind: 'regex',
      config: { pattern: '(' },
    };
    expect(gradeDeterministicCriterion('anything', c)?.passed).toBe(false);
  });

  it('minWords / maxWords count words', () => {
    const min: RubricCriterion = {
      id: 'm',
      label: 'min',
      weight: 1,
      kind: 'minWords',
      config: { min: 3 },
    };
    expect(gradeDeterministicCriterion('one two three', min)?.passed).toBe(
      true,
    );
    expect(gradeDeterministicCriterion('too short', min)?.passed).toBe(false);
    const max: RubricCriterion = {
      id: 'x',
      label: 'max',
      weight: 1,
      kind: 'maxWords',
      config: { max: 2 },
    };
    expect(gradeDeterministicCriterion('one two', max)?.passed).toBe(true);
    expect(gradeDeterministicCriterion('one two three', max)?.passed).toBe(
      false,
    );
  });

  it('returns null for llm criteria (provider grades those)', () => {
    const c: RubricCriterion = {
      id: 'l',
      label: 'tone',
      weight: 1,
      kind: 'llm',
      config: { concepts: ['empathy'] },
    };
    expect(gradeDeterministicCriterion('text', c)).toBeNull();
    expect(isLlmCriterion(c)).toBe(true);
  });
});

describe('scoreRubric', () => {
  const r = (id: string, weight: number, passed: boolean): CriterionResult => ({
    id,
    label: id,
    weight,
    passed,
  });

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

describe('fail-closed grading', () => {
  it('keyword criterion with an empty config FAILS', () => {
    const empty: RubricCriterion = {
      id: 'k',
      label: 'k',
      weight: 1,
      kind: 'keyword',
      config: {},
    };
    expect(gradeDeterministicCriterion('anything at all', empty)?.passed).toBe(
      false,
    );
    const blanks: RubricCriterion = {
      id: 'k',
      label: 'k',
      weight: 1,
      kind: 'keyword',
      config: { any: ['', '  '] },
    };
    expect(gradeDeterministicCriterion('anything', blanks)?.passed).toBe(false);
  });

  it('unknown kinds fail instead of being dropped', () => {
    const c = {
      id: 'u',
      label: 'u',
      weight: 1,
      kind: 'vibes',
    } as unknown as RubricCriterion;
    expect(gradeDeterministicCriterion('x', c)).toMatchObject({
      passed: false,
    });
  });

  it('regex and keyword share the same Unicode normalisation', () => {
    const kw: RubricCriterion = {
      id: 'k',
      label: 'k',
      weight: 1,
      kind: 'keyword',
      config: { all: ['café'] },
    };
    const re: RubricCriterion = {
      id: 'r',
      label: 'r',
      weight: 1,
      kind: 'regex',
      config: { pattern: 'café' },
    };
    const decomposed = 'CAFÉ au lait';
    expect(gradeDeterministicCriterion(decomposed, kw)?.passed).toBe(true);
    expect(gradeDeterministicCriterion(decomposed, re)?.passed).toBe(true);
    expect(normalizeForMatch('É')).toBe(normalizeForMatch('é'));
  });

  it('regex only scans the first MAX_REGEX_INPUT_LENGTH characters', () => {
    const re: RubricCriterion = {
      id: 'r',
      label: 'r',
      weight: 1,
      kind: 'regex',
      config: { pattern: 'needle' },
    };
    expect(
      gradeDeterministicCriterion(
        'x'.repeat(MAX_REGEX_INPUT_LENGTH) + 'needle',
        re,
      )?.passed,
    ).toBe(false);
  });

  it('unsafe or over-long patterns fail closed at grade time', () => {
    const nested: RubricCriterion = {
      id: 'r',
      label: 'r',
      weight: 1,
      kind: 'regex',
      config: { pattern: '(a+)+$' },
    };
    const started = Date.now();
    expect(
      gradeDeterministicCriterion('a'.repeat(40) + '!', nested)?.passed,
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
    const long: RubricCriterion = {
      id: 'r',
      label: 'r',
      weight: 1,
      kind: 'regex',
      config: { pattern: 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1) },
    };
    expect(gradeDeterministicCriterion('a', long)?.passed).toBe(false);
  });
});

describe('regexSafetyProblem', () => {
  it.each([
    '(a+)+',
    '(a*)*',
    '(\\w+\\s?)*',
    '(?:x{2,})+',
    '((ab)+)+',
    '(a+){2,}',
    '(.)\\1',
  ])('rejects %s', (p) => {
    expect(regexSafetyProblem(p)).not.toBeNull();
  });
  it.each([
    '\\d+',
    'try\\s*catch',
    '(foo|bar)+',
    '(ab)?c+',
    '[(+)]+',
    'a{2}',
    '(a+)?',
    '(colou?r)s*',
  ])('accepts %s', (p) => {
    expect(regexSafetyProblem(p)).toBeNull();
  });
});

describe('validateRubric', () => {
  const good: RubricCriterion[] = [
    {
      id: 'kw',
      label: 'kw',
      weight: 2,
      kind: 'keyword',
      config: { all: ['try'] },
    },
    {
      id: 're',
      label: 're',
      weight: 1,
      kind: 'regex',
      config: { pattern: '\\bcatch\\b', flags: 'm' },
    },
    {
      id: 'min',
      label: 'min',
      weight: 1,
      kind: 'minWords',
      config: { min: 10 },
    },
    {
      id: 'llm',
      label: 'llm',
      weight: 2,
      kind: 'llm',
      config: { concepts: ['recover'] },
    },
  ];

  it('accepts a well-formed rubric', () => {
    expect(validateRubric(good, 70)).toEqual([]);
  });

  it('rejects unknown kinds, empty keywords, bad regexes, duplicate ids', () => {
    const errors = validateRubric(
      [
        { id: 'a', label: 'a', weight: 1, kind: 'vibes' },
        { id: 'b', label: 'b', weight: 1, kind: 'keyword', config: {} },
        {
          id: 'c',
          label: 'c',
          weight: 1,
          kind: 'regex',
          config: { pattern: '(a+)+' },
        },
        {
          id: 'd',
          label: 'd',
          weight: 1,
          kind: 'regex',
          config: { pattern: 'x', flags: 'g' },
        },
        {
          id: 'd',
          label: 'dup',
          weight: 1,
          kind: 'minWords',
          config: { min: 0 },
        },
      ],
      50,
    );
    expect(errors.some((e) => e.includes('unknown kind "vibes"'))).toBe(true);
    expect(errors.some((e) => e.includes('needs at least one term'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('nested quantifiers'))).toBe(true);
    expect(errors.some((e) => e.includes('flag "g"'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('minWords needs'))).toBe(true);
  });

  it('rejects threshold 0 with an empty (or weightless) rubric', () => {
    expect(validateRubric([], 0).length).toBeGreaterThan(0);
    expect(
      validateRubric([{ id: 'a', label: 'a', weight: 0, kind: 'llm' }], 0)
        .length,
    ).toBeGreaterThan(0);
    expect(validateRubric([], 70)).toEqual([]);
  });

  it('rejects a non-array rubric', () => {
    expect(validateRubric({} as unknown, 70)).toEqual([
      'rubric must be an array of criteria',
    ]);
  });
});
