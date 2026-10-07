import type { RubricCriterion } from '@codify/api-client';
import {
  addCriterion,
  draftProblems,
  fromDraft,
  mapRubricErrors,
  moveCriterion,
  nextCriterionId,
  removeCriterion,
  splitTerms,
  toDraft,
  totalWeight,
  weightHint,
  weightShare,
} from './rubric';

const RUBRIC: RubricCriterion[] = [
  {
    id: 'c1',
    label: 'Mentions hooks',
    weight: 60,
    kind: 'keyword',
    config: { any: ['useState', 'useEffect'] },
  },
  {
    id: 'c2',
    label: 'Long enough',
    weight: 40,
    kind: 'minWords',
    config: { min: 30 },
  },
];

describe('rubric builder model', () => {
  it('round-trips criteria through the editable draft', () => {
    const drafts = RUBRIC.map(toDraft);
    expect(drafts[0].any).toBe('useState\nuseEffect');
    expect(drafts.map(fromDraft)).toEqual(RUBRIC);
  });

  it('only sends the config that belongs to the kind', () => {
    const d = {
      ...toDraft(RUBRIC[0]),
      kind: 'regex' as const,
      pattern: 'use\\w+',
      flags: 'i',
    };
    expect(fromDraft(d)).toEqual({
      id: 'c1',
      label: 'Mentions hooks',
      weight: 60,
      kind: 'regex',
      config: { pattern: 'use\\w+', flags: 'i' },
    });
    const llm = {
      ...d,
      kind: 'llm' as const,
      concepts: 'state, effects',
      instruction: ' be fair ',
    };
    expect(fromDraft(llm).config).toEqual({
      concepts: ['state', 'effects'],
      instruction: 'be fair',
    });
  });

  it('splits terms on commas and newlines', () => {
    expect(splitTerms(' a, b\n\nc ,')).toEqual(['a', 'b', 'c']);
  });

  it('adds criteria with unique ids, removes and reorders them', () => {
    let list = RUBRIC.map(toDraft);
    expect(nextCriterionId(list)).toBe('c3');
    list = addCriterion(list, 'maxWords');
    expect(list).toHaveLength(3);
    expect(list[2]).toMatchObject({ id: 'c3', kind: 'maxWords', max: 200 });
    const [a, b, c] = list;
    expect(moveCriterion(list, c.uid, -1).map((x) => x.id)).toEqual([
      'c1',
      'c3',
      'c2',
    ]);
    expect(moveCriterion(list, a.uid, -1).map((x) => x.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(removeCriterion(list, b.uid).map((x) => x.id)).toEqual(['c1', 'c3']);
  });

  it('gives weight guidance', () => {
    const list = RUBRIC.map(toDraft);
    expect(totalWeight(list)).toBe(100);
    expect(weightHint(list)).toBe('percent');
    expect(weightShare(list, list[0])).toBeCloseTo(0.6);
    expect(weightHint([])).toBe('empty');
    expect(weightHint(list.map((c) => ({ ...c, weight: 0 })))).toBe('zero');
    expect(weightHint(list.map((c) => ({ ...c, weight: 1 })))).toBe('relative');
  });

  it('flags per-field problems before saving', () => {
    const [kw] = RUBRIC.map(toDraft);
    expect(draftProblems(kw)).toEqual([]);
    expect(draftProblems({ ...kw, any: '', all: '' })).toContain('terms');
    expect(draftProblems({ ...kw, kind: 'regex', pattern: '(' })).toContain(
      'pattern',
    );
    expect(
      draftProblems({ ...kw, kind: 'regex', pattern: 'a', flags: 'g' }),
    ).toContain('flags');
    expect(draftProblems({ ...kw, kind: 'minWords', min: 0 })).toContain('min');
    expect(draftProblems({ ...kw, label: ' ', weight: -1 })).toEqual([
      'label',
      'weight',
    ]);
  });

  it('maps INVALID_RUBRIC messages onto criteria by id or position', () => {
    const list = RUBRIC.map(toDraft);
    const { byUid, general } = mapRubricErrors(
      [
        'criterion "c2": minWords needs an integer "min" ≥ 1',
        'criterion #1: duplicate id',
        'at least one criterion needs a weight above 0',
      ],
      list,
    );
    expect(byUid[list[1].uid]).toEqual(['minWords needs an integer "min" ≥ 1']);
    expect(byUid[list[0].uid]).toEqual(['duplicate id']);
    expect(general).toEqual(['at least one criterion needs a weight above 0']);
  });
});
