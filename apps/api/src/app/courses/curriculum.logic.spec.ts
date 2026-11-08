import {
  copyTitle,
  firstLessons,
  validateCurriculumOrder,
} from './curriculum.logic.js';
import { fieldStatus, learnerAlias } from './course-insights.service.js';

const current = [
  { id: 'm1', lessonIds: ['a', 'b'] },
  { id: 'm2', lessonIds: ['c'] },
];

describe('validateCurriculumOrder', () => {
  it('accepts permutations, including lessons moved between modules', () => {
    expect(
      validateCurriculumOrder(current, [
        { id: 'm2', lessonIds: ['c', 'a'] },
        { id: 'm1', lessonIds: ['b'] },
      ]),
    ).toEqual([]);
  });

  it('rejects missing, unknown and duplicated modules or lessons', () => {
    expect(
      validateCurriculumOrder(current, [
        { id: 'm1', lessonIds: ['a', 'b', 'c'] },
      ]),
    ).toContain('modules must list every module of the course exactly once');
    expect(
      validateCurriculumOrder(current, [
        { id: 'm1', lessonIds: ['a', 'a'] },
        { id: 'm2', lessonIds: ['c'] },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'a lesson is listed twice',
        'lessons must list every lesson of the course exactly once',
      ]),
    );
    expect(
      validateCurriculumOrder(current, [
        { id: 'm1', lessonIds: ['a', 'b', 'x'] },
        { id: 'm2', lessonIds: ['c'] },
      ]),
    ).toEqual(['lessons must list every lesson of the course exactly once']);
  });
});

describe('firstLessons / copyTitle', () => {
  it('takes the first N lessons in curriculum order', () => {
    expect(firstLessons(current, 2)).toEqual(['a', 'b']);
    expect(firstLessons(current, 5)).toEqual(['a', 'b', 'c']);
    expect(firstLessons(current, -1)).toEqual([]);
  });

  it('suffixes per locale and keeps titles within 120 chars', () => {
    expect(copyTitle('Intro', 'pt-BR')).toBe('Intro (cópia)');
    expect(copyTitle('Intro', 'en-US')).toBe('Intro (copy)');
    expect(copyTitle('x'.repeat(120), 'en-US')).toHaveLength(120);
  });
});

describe('course insight helpers', () => {
  it('derives a field status per locale', () => {
    const rows = [
      { locale: 'pt-BR', value: 'Olá', outdated: false },
      { locale: 'en-US', value: 'Hi', outdated: true },
    ];
    expect(fieldStatus(rows, 'en-US')).toBe('outdated');
    expect(fieldStatus(rows, 'pt-BR')).toBe('done');
    expect(fieldStatus([], 'en-US')).toBe('missing');
    expect(
      fieldStatus([{ locale: 'en-US', value: '', outdated: false }], 'en-US'),
    ).toBe('missing');
  });

  it('pseudonymises learners per course', () => {
    const a = learnerAlias('u1', 'c1');
    expect(a).toMatch(/^L-[0-9A-F]{8}$/);
    expect(learnerAlias('u1', 'c1')).toBe(a);
    expect(learnerAlias('u1', 'c2')).not.toBe(a);
    expect(a).not.toContain('u1');
  });
});
