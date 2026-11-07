import {
  buildQuizAnswerHashes,
  checkQuizAnswerHash,
  extractQuizzes,
  gradeQuiz,
  hashQuizAnswer,
  kitchenSinkLessonDoc,
  lessonDocSchema,
  sanitizeQuizAnswers,
  stripQuizAnswers,
  type QuizNode,
} from '../index.js';

describe('extractQuizzes', () => {
  it('returns quiz attrs in document order', () => {
    expect(extractQuizzes(kitchenSinkLessonDoc()).map((q) => q.id)).toEqual([
      'quiz',
      'q2',
    ]);
  });

  it('returns [] for a doc without quizzes', () => {
    expect(extractQuizzes({ content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('gradeQuiz', () => {
  const d = kitchenSinkLessonDoc();

  it('scores 100 and passes with every answer right', () => {
    const r = gradeQuiz(d, { quiz: ['a'], q2: ['b', 'a'] });
    expect(r.scorePct).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.correctCount).toBe(2);
    expect(r.perQuestion).toEqual([
      {
        id: 'quiz',
        correct: true,
        correctOptionIds: ['a'],
        explanation: 'computed() is read-only and effect() runs side effects.',
      },
      {
        id: 'q2',
        correct: true,
        correctOptionIds: ['a', 'b'],
        explanation: null,
      },
    ]);
  });

  it('needs the exact option set for multiple choice', () => {
    expect(
      gradeQuiz(d, { quiz: ['a'], q2: ['a'] }).perQuestion[1].correct,
    ).toBe(false);
    expect(
      gradeQuiz(d, { quiz: ['a'], q2: ['a', 'b', 'c'] }).perQuestion[1].correct,
    ).toBe(false);
  });

  it('ignores duplicates in a selection', () => {
    expect(
      gradeQuiz(d, { quiz: ['a', 'a'], q2: ['a', 'b', 'b'] }).scorePct,
    ).toBe(100);
  });

  it('treats missing / malformed answers as wrong', () => {
    const r = gradeQuiz(d, { quiz: 'a' as unknown as string[] });
    expect(r.scorePct).toBe(0);
    expect(r.passed).toBe(false);
    expect(gradeQuiz(d, null).scorePct).toBe(0);
  });

  it('rounds the score and applies the 70% default threshold', () => {
    const three = {
      content: [1, 2, 3].map((n) => ({
        type: 'quiz' as const,
        attrs: {
          id: `q${n}`,
          question: 'Q',
          kind: 'single' as const,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
        },
      })),
    };
    const twoOfThree = gradeQuiz(three, { q1: ['a'], q2: ['a'], q3: ['b'] });
    expect(twoOfThree.scorePct).toBe(67);
    expect(twoOfThree.passed).toBe(false);
    expect(
      gradeQuiz(
        three,
        { q1: ['a'], q2: ['a'], q3: ['b'] },
        { passThresholdPct: 60 },
      ).passed,
    ).toBe(true);
  });

  it('half right fails at 70 and passes at a 50 threshold', () => {
    expect(gradeQuiz(d, { quiz: ['a'] }).passed).toBe(false);
    expect(gradeQuiz(d, { quiz: ['a'] }, { passThresholdPct: 50 }).passed).toBe(
      true,
    );
  });

  it('ignores answers for unknown quizzes and never passes an empty quiz', () => {
    const r = gradeQuiz({ content: [] }, { nope: ['a'] });
    expect(r).toMatchObject({ scorePct: 0, passed: false, totalCount: 0 });
  });

  it('rejects an out-of-range threshold', () => {
    expect(() => gradeQuiz(d, {}, { passThresholdPct: 101 })).toThrow(
      RangeError,
    );
  });

  it('refuses to grade a stripped doc', () => {
    expect(() => gradeQuiz(stripQuizAnswers(d), { quiz: ['a'] })).toThrow(
      /no answer key/,
    );
  });
});

describe('stripQuizAnswers', () => {
  it('removes answer keys and explanations without mutating the input', () => {
    const d = kitchenSinkLessonDoc();
    const stripped = stripQuizAnswers(d);
    const quizzes = stripped.content.filter(
      (b): b is QuizNode => b.type === 'quiz',
    );
    expect(quizzes).toHaveLength(2);
    for (const q of quizzes) {
      expect(q.attrs.correctOptionIds).toBeUndefined();
      expect(q.attrs.explanation).toBeUndefined();
      expect(q.attrs.options.length).toBeGreaterThan(1);
    }
    expect(JSON.stringify(stripped)).not.toContain('correctOptionIds');
    // Original keeps its keys; non-quiz content is unchanged.
    expect(
      (d.content.find((b) => b.type === 'quiz') as QuizNode).attrs
        .correctOptionIds,
    ).toEqual(['a']);
    expect(stripped.content.filter((b) => b.type !== 'quiz')).toEqual(
      d.content.filter((b) => b.type !== 'quiz'),
    );
  });

  it('a stripped doc no longer validates as an authored doc', () => {
    expect(
      lessonDocSchema.safeParse(stripQuizAnswers(kitchenSinkLessonDoc()))
        .success,
    ).toBe(false);
  });
});

describe('sanitizeQuizAnswers', () => {
  it('keeps only known quizzes and options', () => {
    expect(
      sanitizeQuizAnswers(kitchenSinkLessonDoc(), {
        quiz: ['a', 'zzz', 7],
        q2: 'b',
        unknown: ['a'],
      }),
    ).toEqual({ quiz: ['a'], q2: [] });
  });
});

describe('offline answer hashes', () => {
  it('matches only the correct, order-insensitive selection', async () => {
    const hashes = await buildQuizAnswerHashes(
      kitchenSinkLessonDoc(),
      'salt-1',
    );
    expect(Object.keys(hashes)).toEqual(['quiz', 'q2']);
    expect(
      await checkQuizAnswerHash(hashes['q2'], 'salt-1', 'q2', ['b', 'a']),
    ).toBe(true);
    expect(await checkQuizAnswerHash(hashes['q2'], 'salt-1', 'q2', ['a'])).toBe(
      false,
    );
    expect(
      await checkQuizAnswerHash(hashes['quiz'], 'salt-2', 'quiz', ['a']),
    ).toBe(false);
  });

  it('is a hex sha-256 bound to the quiz id', async () => {
    const h = await hashQuizAnswer('s', 'q1', ['a']);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashQuizAnswer('s', 'q2', ['a'])).not.toBe(h);
  });
});
