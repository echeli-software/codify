import { buildRule, parseRule } from './badge-rule';

describe('badge rule builder model', () => {
  it('round-trips the common shapes from docs/07 §7', () => {
    const rules = [
      { all: [{ event: 'lesson_complete', count: { gte: 1 } }] },
      { all: [{ metric: 'streak.current_days', gte: 7 }] },
      {
        any: [
          { event: 'exercise_pass', count: { gte: 50 } },
          { metric: 'categories.completed', gt: 2 },
        ],
      },
    ];
    for (const r of rules) {
      const state = parseRule(r);
      expect(state).not.toBeNull();
      expect(buildRule(state!)).toEqual(r);
    }
  });

  it('treats a missing event count as "at least once"', () => {
    expect(parseRule({ all: [{ event: 'quiz_pass' }] })?.clauses[0]).toEqual({
      type: 'event',
      name: 'quiz_pass',
      op: 'gte',
      value: 1,
    });
  });

  it('leaves shapes it cannot represent to the JSON view', () => {
    expect(parseRule({ all: [{ metric: 'x', gte: 1, lte: 5 }] })).toBeNull();
    expect(
      parseRule({
        all: [{ event: 'ai_prompt_pass', where: { scorePct: { gte: 80 } } }],
      }),
    ).toBeNull();
    expect(parseRule({ all: [], any: [] })).toBeNull();
    expect(parseRule('nope')).toBeNull();
    expect(parseRule({ any: [] })).toEqual({ combinator: 'any', clauses: [] });
  });
});
