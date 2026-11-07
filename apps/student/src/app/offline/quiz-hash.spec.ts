import { webcrypto } from 'node:crypto';
import { checkQuizAnswer, quizAnswerHash } from './quiz-hash';

describe('quizAnswerHash', () => {
  beforeAll(() => {
    // jsdom has no SubtleCrypto.
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  });

  // Vectors pinned to @codify/lesson-schema `hashQuizAnswer` (same canonical form).
  it('matches the lesson-schema algorithm', async () => {
    expect(await quizAnswerHash('salt-1', 'q2', ['b', 'a'])).toBe(
      '496302527bb1f2708bb02e0f78d6117c7e47d77bc6b1ce60a41862de7a8bd41a',
    );
    expect(await quizAnswerHash('salt-2', 'quiz', ['a'])).toBe(
      '9626855a5ca41e7752e8c6db99668cdc565e9affc7b2e486afea63e4cb5233d0',
    );
  });

  it('is order- and duplicate-insensitive', async () => {
    const h = await quizAnswerHash('s', 'q', ['a', 'b']);
    expect(await checkQuizAnswer(h, 's', 'q', ['b', 'a', 'a'])).toBe(true);
    expect(await checkQuizAnswer(h, 's', 'q', ['a'])).toBe(false);
  });
});
