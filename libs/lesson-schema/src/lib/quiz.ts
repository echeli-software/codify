/**
 * Pure quiz helpers shared by the API (authoritative grading), the student
 * app (offline instant feedback) and the renderer.
 *
 * Grading rule: a question is correct when the selected option set equals
 * the correct option set exactly (order-insensitive, duplicates ignored).
 * Score = correct questions / total questions, rounded to an integer pct.
 */

import type { LessonDoc, QuizAttrs, QuizNode } from './types.js';
import { walkBlocks } from './walk.js';

/** `{ [quizBlockId]: selectedOptionIds[] }` — the wire + storage shape. */
export type QuizAnswers = Record<string, string[]>;

export const DEFAULT_QUIZ_PASS_PCT = 70;

export interface QuizQuestionResult {
  id: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation: string | null;
}

export interface QuizGradeResult {
  scorePct: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  perQuestion: QuizQuestionResult[];
}

export interface GradeQuizOptions {
  /** Inclusive pass threshold, 0-100. Default 70. */
  passThresholdPct?: number;
}

/** Every quiz block's attrs in document order. */
export function extractQuizzes(doc: Pick<LessonDoc, 'content'>): QuizAttrs[] {
  const out: QuizAttrs[] = [];
  walkBlocks(doc, (node) => {
    if (node.type === 'quiz') out.push((node as QuizNode).attrs);
  });
  return out;
}

/** De-duplicated string ids from an untrusted answer value. */
function selection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

/**
 * Grade `answers` against the answer keys in `doc`. Unanswered questions
 * count as wrong; answers for unknown quiz ids are ignored.
 *
 * Throws when the doc has been stripped of answer keys (never grade a
 * student-delivered doc).
 */
export function gradeQuiz(
  doc: Pick<LessonDoc, 'content'>,
  answers: QuizAnswers | Record<string, unknown> | null | undefined,
  options: GradeQuizOptions = {},
): QuizGradeResult {
  const threshold = options.passThresholdPct ?? DEFAULT_QUIZ_PASS_PCT;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('passThresholdPct must be between 0 and 100');
  }
  const quizzes = extractQuizzes(doc);
  const given = (answers ?? {}) as Record<string, unknown>;

  const perQuestion = quizzes.map((q): QuizQuestionResult => {
    if (!Array.isArray(q.correctOptionIds)) {
      throw new Error(
        `Quiz "${q.id}" has no answer key — cannot grade a stripped doc`,
      );
    }
    const correctOptionIds = [...q.correctOptionIds];
    const picked = Object.prototype.hasOwnProperty.call(given, q.id)
      ? selection(given[q.id])
      : [];
    return {
      id: q.id,
      correct: sameSet(picked, correctOptionIds),
      correctOptionIds,
      explanation: q.explanation ?? null,
    };
  });

  const totalCount = perQuestion.length;
  const correctCount = perQuestion.filter((p) => p.correct).length;
  const scorePct =
    totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
  return {
    scorePct,
    passed: totalCount > 0 && scorePct >= threshold,
    correctCount,
    totalCount,
    perQuestion,
  };
}

/**
 * Copy of `doc` safe to send to a student: every quiz loses its
 * `correctOptionIds` and `explanation` (the explanation is returned by the
 * grading endpoint after an attempt). Pure — the input is not mutated.
 */
export function stripQuizAnswers<T extends Pick<LessonDoc, 'content'>>(
  doc: T,
): T {
  const copy = JSON.parse(JSON.stringify(doc)) as T;
  walkBlocks(copy, (node) => {
    if (node.type !== 'quiz') return;
    const attrs = (node as QuizNode).attrs as Partial<QuizAttrs>;
    delete attrs.correctOptionIds;
    delete attrs.explanation;
  });
  return copy;
}

/** Restrict `answers` to known quizzes/options (for storage). */
export function sanitizeQuizAnswers(
  doc: Pick<LessonDoc, 'content'>,
  answers: Record<string, unknown> | null | undefined,
): QuizAnswers {
  const out: QuizAnswers = {};
  const given = answers ?? {};
  for (const q of extractQuizzes(doc)) {
    if (!Object.prototype.hasOwnProperty.call(given, q.id)) continue;
    const optionIds = new Set(q.options.map((o) => o.id));
    out[q.id] = selection(given[q.id]).filter((id) => optionIds.has(id));
  }
  return out;
}

// ─── Offline answer keys (docs/16 §5) ──────────────────────────────────────

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 over (salt, quizId, sorted selection). The offline bundle ships
 * one hash per question so the client can give instant feedback without
 * carrying the plain answer key. NOTE: option sets are tiny, so a hash is
 * obfuscation, not secrecy — the server stays authoritative and re-grades
 * every attempt on sync.
 */
export async function hashQuizAnswer(
  salt: string,
  quizId: string,
  optionIds: readonly string[],
): Promise<string> {
  const canonical = [...new Set(optionIds)].sort().join('\u0001');
  const data = new TextEncoder().encode(
    `${salt}\u0000${quizId}\u0000${canonical}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/** `{ [quizId]: hash(correctOptionIds) }` for every quiz in an authored doc. */
export async function buildQuizAnswerHashes(
  doc: Pick<LessonDoc, 'content'>,
  salt: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const q of extractQuizzes(doc)) {
    if (!q.correctOptionIds) continue;
    out[q.id] = await hashQuizAnswer(salt, q.id, q.correctOptionIds);
  }
  return out;
}

/** Client-side offline check against a bundle's answer hash. */
export async function checkQuizAnswerHash(
  expectedHash: string,
  salt: string,
  quizId: string,
  selected: readonly string[],
): Promise<boolean> {
  return (await hashQuizAnswer(salt, quizId, selected)) === expectedHash;
}
