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
  isQuizAnswered,
  orderAnswerTokens,
  orderFromTokens,
  stableShuffle,
  lessonStructureIssues,
  type LessonDoc,
  type QuizAttrs,
  type QuizNode,
} from '../index.js';

/** The kitchen sink with only its two choice quizzes (single + multiple). */
function choiceDoc(): LessonDoc {
  const d = kitchenSinkLessonDoc();
  return {
    ...d,
    content: d.content.filter(
      (b) => b.type !== 'quiz' || ['quiz', 'q2'].includes(b.attrs.id),
    ),
  };
}

describe('extractQuizzes', () => {
  it('returns quiz attrs in document order', () => {
    expect(extractQuizzes(kitchenSinkLessonDoc()).map((q) => q.id)).toEqual([
      'quiz',
      'q2',
      'q3',
      'q4',
    ]);
  });

  it('returns [] for a doc without quizzes', () => {
    expect(extractQuizzes({ content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('gradeQuiz', () => {
  const d = choiceDoc();

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
    const d = choiceDoc();
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
      lessonDocSchema.safeParse(stripQuizAnswers(choiceDoc())).success,
    ).toBe(false);
  });
});

describe('sanitizeQuizAnswers', () => {
  it('keeps only known quizzes and options', () => {
    expect(
      sanitizeQuizAnswers(choiceDoc(), {
        quiz: ['a', 'zzz', 7],
        q2: 'b',
        unknown: ['a'],
      }),
    ).toEqual({ quiz: ['a'], q2: [] });
  });
});

describe('offline answer hashes', () => {
  it('matches only the correct, order-insensitive selection', async () => {
    const hashes = await buildQuizAnswerHashes(choiceDoc(), 'salt-1');
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

describe('match and order quizzes', () => {
  const d = kitchenSinkLessonDoc();
  const q = (id: string) =>
    extractQuizzes(d).find((x) => x.id === id) as QuizAttrs;

  it('grades a match quiz on the exact pair set', () => {
    const right = { q3: ['c:z', 'a:x', 'b:y'] };
    expect(gradeQuiz(d, right).perQuestion[2]).toMatchObject({
      id: 'q3',
      correct: true,
      correctOptionIds: ['a:x', 'b:y', 'c:z'],
    });
    expect(
      gradeQuiz(d, { q3: ['a:y', 'b:x', 'c:z'] }).perQuestion[2].correct,
    ).toBe(false);
    // Partial and duplicate pairs never pass.
    expect(gradeQuiz(d, { q3: ['a:x', 'b:y'] }).perQuestion[2].correct).toBe(
      false,
    );
    expect(
      gradeQuiz(d, { q3: ['a:x', 'a:y', 'b:y', 'c:z'] }).perQuestion[2].correct,
    ).toBe(false);
  });

  it('grades an order quiz on positions', () => {
    const tokens = orderAnswerTokens(['a', 'b', 'c']);
    expect(tokens).toEqual(['0:a', '1:b', '2:c']);
    const r = gradeQuiz(d, { q4: tokens });
    expect(r.perQuestion[3]).toMatchObject({
      correct: true,
      correctOptionIds: ['0:a', '1:b', '2:c'],
    });
    expect(
      gradeQuiz(d, { q4: orderAnswerTokens(['b', 'a', 'c']) }).perQuestion[3]
        .correct,
    ).toBe(false);
    // A plain id list (unordered) is not an answer.
    expect(gradeQuiz(d, { q4: ['a', 'b', 'c'] }).perQuestion[3].correct).toBe(
      false,
    );
    expect(orderFromTokens(['2:c', '0:a', '1:b', 'junk'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('sanitizes tokens per kind', () => {
    expect(
      sanitizeQuizAnswers(d, {
        q3: ['a:x', 'q:x', 'b:nope', 'b:y', 7],
        q4: ['0:a', '1:c', '9:b', 'x'],
      }),
    ).toEqual({ q3: ['a:x', 'b:y'], q4: ['0:a', '1:c'] });
    expect(
      sanitizeQuizAnswers(d, { q3: ['a:x', 'a:y'], q4: ['0:a', '0:b'] }),
    ).toEqual({ q3: [], q4: [] });
    expect(isQuizAnswered(q('q3'), ['a:x', 'b:y'])).toBe(false);
    expect(isQuizAnswered(q('q3'), ['a:x', 'b:y', 'c:z'])).toBe(true);
    expect(isQuizAnswered(q('q4'), orderAnswerTokens(['c', 'a', 'b']))).toBe(
      true,
    );
    expect(isQuizAnswered(q('quiz'), ['b'])).toBe(true);
  });

  it('strips keys and shuffles order options / match targets stably', () => {
    const s1 = stripQuizAnswers(d);
    const s2 = stripQuizAnswers(d);
    const order = s1.content.find(
      (b) => b.type === 'quiz' && b.attrs.id === 'q4',
    ) as QuizNode;
    const match = s1.content.find(
      (b) => b.type === 'quiz' && b.attrs.id === 'q3',
    ) as QuizNode;
    expect(order.attrs.options.map((o) => o.id)).not.toEqual(['a', 'b', 'c']);
    expect([...order.attrs.options.map((o) => o.id)].sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(match.attrs.targets?.map((t) => t.id)).not.toEqual(['x', 'y', 'z']);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(JSON.stringify(s1)).not.toContain('a:x');
  });

  it('never returns the input order from stableShuffle', () => {
    for (const seed of ['a', 'b', 'c', 'q1', 'q2', 'zz']) {
      expect(stableShuffle([1, 2], seed)).toEqual([2, 1]);
      expect(stableShuffle([1, 2, 3, 4], seed)).not.toEqual([1, 2, 3, 4]);
    }
    expect(stableShuffle([1], 'x')).toEqual([1]);
  });

  it('offline hashes accept the token answers for match and order', async () => {
    const hashes = await buildQuizAnswerHashes(d, 'salt');
    expect(
      await checkQuizAnswerHash(hashes['q3'], 'salt', 'q3', [
        'b:y',
        'c:z',
        'a:x',
      ]),
    ).toBe(true);
    expect(
      await checkQuizAnswerHash(
        hashes['q4'],
        'salt',
        'q4',
        orderAnswerTokens(['a', 'b', 'c']),
      ),
    ).toBe(true);
    expect(
      await checkQuizAnswerHash(
        hashes['q4'],
        'salt',
        'q4',
        orderAnswerTokens(['b', 'a', 'c']),
      ),
    ).toBe(false);
  });

  it('validates match / order answer keys', () => {
    const base = q('q3');
    const valid = (attrs: Partial<QuizAttrs>) =>
      lessonDocSchema.safeParse({
        type: 'doc',
        version: 1,
        content: [{ type: 'quiz', attrs: { ...base, ...attrs } }],
      }).success;
    expect(valid({})).toBe(true);
    expect(valid({ correctOptionIds: ['a:x', 'b:y'] })).toBe(false);
    expect(valid({ correctOptionIds: ['a:x', 'b:x', 'c:z'] })).toBe(false);
    expect(valid({ correctOptionIds: ['a:x', 'b:y', 'c:nope'] })).toBe(false);
    expect(valid({ targets: base.targets?.slice(0, 2) })).toBe(false);
    // Distractor answers are fine.
    expect(
      valid({ targets: [...(base.targets ?? []), { id: 'w', text: 'Other' }] }),
    ).toBe(true);
    const ord = q('q4');
    const validOrder = (attrs: Partial<QuizAttrs>) =>
      lessonDocSchema.safeParse({
        type: 'doc',
        version: 1,
        content: [{ type: 'quiz', attrs: { ...ord, ...attrs } }],
      }).success;
    expect(validOrder({})).toBe(true);
    expect(validOrder({ correctOptionIds: ['a', 'b'] })).toBe(false);
    expect(validOrder({ targets: [{ id: 'x', text: 'X' }] })).toBe(false);
  });
});

describe('lessonStructureIssues', () => {
  const src = kitchenSinkLessonDoc();
  const clone = (): LessonDoc => JSON.parse(JSON.stringify(src));

  it('accepts a translation that only changes text', () => {
    const t = clone();
    const quiz = t.content.find((b) => b.type === 'quiz') as QuizNode;
    quiz.attrs.question = 'Qual função cria um signal gravável?';
    quiz.attrs.options[0].text = 'signal() (pt)';
    const p = t.content.find((b) => b.type === 'paragraph');
    if (p && p.type === 'paragraph')
      p.content = [{ type: 'text', text: 'Olá' }];
    expect(lessonStructureIssues(src, t)).toEqual([]);
  });

  it('lists added/removed blocks, changed types and locked attrs', () => {
    const t = clone();
    t.content.pop();
    expect(lessonStructureIssues(src, t)[0]).toMatchObject({
      path: 'content',
      code: 'structure_mismatch',
    });
    const t2 = clone();
    const qi = t2.content.findIndex((b) => b.type === 'quiz');
    (t2.content[qi] as QuizNode).attrs.correctOptionIds = ['b'];
    (t2.content[qi] as QuizNode).attrs.options[0].id = 'zz';
    t2.content[0] = { type: 'horizontalRule' };
    const paths = lessonStructureIssues(src, t2).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'content.0.type',
        `content.${qi}.attrs.correctOptionIds`,
        `content.${qi}.attrs.options`,
      ]),
    );
  });

  it('rejects non-docs', () => {
    expect(lessonStructureIssues(src, 'nope')).toHaveLength(1);
  });
});
