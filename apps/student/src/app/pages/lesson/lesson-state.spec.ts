import { ProblemDetailsError } from '@codify/api-client';
import type { LessonDoc } from '@codify/lesson-schema';
import {
  allQuizzesAnswered,
  classifyLoadError,
  hasRefBlocks,
  isInteractiveType,
  quizIds,
  requiredPlansFrom,
  toQuizView,
} from './lesson-state';

const doc = (content: unknown[]): LessonDoc =>
  ({ type: 'doc', version: 1, content }) as LessonDoc;

const quiz = (id: string) => ({
  type: 'quiz',
  attrs: {
    id,
    question: 'Q',
    kind: 'single',
    options: [{ id: 'a', text: 'A' }],
  },
});

describe('lesson state helpers', () => {
  it.each([
    [new ProblemDetailsError({ status: 402 }), 'paywall'],
    [new ProblemDetailsError({ status: 404 }), 'notFound'],
    [new ProblemDetailsError({ status: 0 }), 'network'],
    [new ProblemDetailsError({ status: 500 }), 'error'],
    [{ status: 402, error: { requiredPlans: [] } }, 'paywall'],
    [new Error('boom'), 'network'],
  ])('classifies %p as %s', (err, expected) => {
    expect(classifyLoadError(err)).toBe(expected);
  });

  it('reads requiredPlans from the 402 problem body', () => {
    const err = new ProblemDetailsError({
      status: 402,
      data: {
        requiredPlans: [
          { id: 'p1', slug: 'pro', name: 'Pro' },
          { bogus: true },
        ],
      },
    });
    expect(requiredPlansFrom(err)).toEqual([
      { id: 'p1', slug: 'pro', name: 'Pro' },
    ]);
    expect(requiredPlansFrom(new ProblemDetailsError({ status: 402 }))).toEqual(
      [],
    );
  });

  it('finds quiz blocks and checks every quiz is answered', () => {
    const d = doc([{ type: 'paragraph' }, quiz('q1'), quiz('q2')]);
    expect(quizIds(d)).toEqual(['q1', 'q2']);
    expect(allQuizzesAnswered(d, { q1: ['a'] })).toBe(false);
    expect(allQuizzesAnswered(d, { q1: ['a'], q2: ['b'] })).toBe(true);
    expect(allQuizzesAnswered(doc([{ type: 'paragraph' }]), {})).toBe(false);
  });

  it('detects ref blocks and interactive lesson types (CAPSTONE included)', () => {
    expect(
      hasRefBlocks(doc([{ type: 'exerciseRef', attrs: { exerciseId: 'e' } }])),
    ).toBe(true);
    expect(hasRefBlocks(doc([quiz('q1')]))).toBe(false);
    expect(isInteractiveType('CAPSTONE')).toBe(true);
    expect(isInteractiveType('SCENARIO')).toBe(true);
    expect(isInteractiveType('QUIZ')).toBe(false);
  });

  it('maps a graded attempt to renderer feedback', () => {
    expect(
      toQuizView({
        attemptId: 'a',
        scorePct: 50,
        passed: false,
        correctCount: 1,
        totalCount: 2,
        passThresholdPct: 100,
        perQuestion: [{ id: 'q1', correct: false }],
      }),
    ).toEqual({
      scorePct: 50,
      passed: false,
      perQuestion: [
        { id: 'q1', correct: false, correctOptionIds: [], explanation: null },
      ],
    });
  });
});
