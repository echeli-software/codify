/**
 * Pure quiz helpers shared by the API (authoritative grading), the student
 * app (offline instant feedback) and the renderer.
 *
 * Every quiz answer is a list of string tokens compared as a SET (see the
 * `QuizAttrs` docs for the token shape per kind): option ids for
 * single/multiple, `"<optionId>:<targetId>"` pairs for match and
 * `"<index>:<optionId>"` positions for order. A question is correct when the
 * answer token set equals the key token set exactly. Score = correct
 * questions / total questions, rounded to an integer pct.
 */

import type { LessonDoc, QuizAttrs, QuizNode, QuizOption } from './types.js';
import { walkBlocks } from './walk.js';

/** `{ [quizBlockId]: answerTokens[] }` — the wire + storage shape. */
export type QuizAnswers = Record<string, string[]>;

export const DEFAULT_QUIZ_PASS_PCT = 70;

export interface QuizQuestionResult {
  id: string;
  correct: boolean;
  /** The answer key as tokens (same shape as the answer for that kind). */
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

// ─── Tokens ────────────────────────────────────────────────────────────────

/** Answer token of a match pair. */
export function matchToken(optionId: string, targetId: string): string {
  return `${optionId}:${targetId}`;
}

/** `"a:x"` → `["a", "x"]`, or null when not a pair token. */
export function parseMatchToken(token: string): [string, string] | null {
  const i = token.indexOf(':');
  if (i <= 0 || i === token.length - 1) return null;
  const left = token.slice(0, i);
  const right = token.slice(i + 1);
  return right.includes(':') ? null : [left, right];
}

/** An ordered option-id sequence → order-quiz answer tokens. */
export function orderAnswerTokens(sequence: readonly string[]): string[] {
  return sequence.map((id, i) => `${i}:${id}`);
}

/** Order-quiz answer tokens → the option-id sequence (unknown slots dropped). */
export function orderFromTokens(tokens: readonly string[]): string[] {
  const slots: { i: number; id: string }[] = [];
  for (const t of tokens) {
    const m = /^(\d{1,3}):([A-Za-z0-9_-]{1,64})$/.exec(t);
    if (m) slots.push({ i: Number(m[1]), id: m[2] });
  }
  return slots.sort((a, b) => a.i - b.i).map((s) => s.id);
}

/** The key of `q` as answer tokens. */
export function quizKeyTokens(q: QuizAttrs): string[] {
  const key = q.correctOptionIds ?? [];
  return q.kind === 'order' ? orderAnswerTokens(key) : [...key];
}

/** De-duplicated string tokens from an untrusted answer value. */
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
 * Restrict one untrusted answer to tokens valid for `q`: known option ids;
 * for match pairs of a known option and target, for order known positions.
 * A match / order answer that pairs an item twice (or puts two items in one
 * slot) is invalid as a whole and becomes `[]`.
 */
export function sanitizeQuizAnswer(q: QuizAttrs, value: unknown): string[] {
  const optionIds = new Set(q.options.map((o) => o.id));
  const tokens = selection(value);
  if (q.kind === 'match') {
    const targetIds = new Set((q.targets ?? []).map((t) => t.id));
    const lefts = new Set<string>();
    const rights = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
      const pair = parseMatchToken(t);
      if (!pair) continue;
      const [l, r] = pair;
      if (!optionIds.has(l) || !targetIds.has(r)) continue;
      // Conflicting pairs invalidate the whole answer (never "first wins").
      if (lefts.has(l) || rights.has(r)) return [];
      lefts.add(l);
      rights.add(r);
      out.push(t);
    }
    return out;
  }
  if (q.kind === 'order') {
    const seen = new Set<string>();
    const positions = new Set<number>();
    const out: string[] = [];
    for (const t of tokens) {
      const m = /^(\d{1,3}):([A-Za-z0-9_-]{1,64})$/.exec(t);
      if (!m) continue;
      const i = Number(m[1]);
      if (i >= q.options.length || !optionIds.has(m[2])) continue;
      if (seen.has(m[2]) || positions.has(i)) return [];
      seen.add(m[2]);
      positions.add(i);
      out.push(t);
    }
    return out;
  }
  return tokens.filter((id) => optionIds.has(id));
}

/**
 * Whether a (possibly partial) answer counts as "answered" for the submit
 * button: any selection for choice quizzes; every left item paired for
 * match; any arrangement for order (the renderer always reports one once the
 * student moves an item or confirms the order).
 */
export function isQuizAnswered(q: QuizAttrs, value: unknown): boolean {
  const tokens = sanitizeQuizAnswer(q, value);
  if (q.kind === 'match') return tokens.length === q.options.length;
  if (q.kind === 'order') return tokens.length === q.options.length;
  return tokens.length > 0;
}

// ─── Grading ───────────────────────────────────────────────────────────────

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
    const correctOptionIds = quizKeyTokens(q);
    // Raw (de-duplicated) tokens: junk or conflicting tokens make it wrong.
    const picked = Object.prototype.hasOwnProperty.call(given, q.id)
      ? selection(given[q.id])
      : [];
    return {
      id: q.id,
      correct: picked.length > 0 && sameSet(picked, correctOptionIds),
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

// ─── Student delivery ──────────────────────────────────────────────────────

/** FNV-1a 32-bit — a stable seed from the quiz id. */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

/**
 * Deterministic shuffle seeded by `seed` that never returns the input order
 * (for ≥ 2 items), so a delivered `order` quiz never starts solved and a
 * `match` quiz's targets never line up with their options.
 */
export function stableShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  if (out.length < 2) return out;
  let s = seedOf(seed);
  const next = () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.every((v, i) => v === items[i])) out.push(out.shift() as T);
  return out;
}

/**
 * Copy of `doc` safe to send to a student: every quiz loses its
 * `correctOptionIds` and `explanation` (the explanation is returned by the
 * grading endpoint after an attempt); `order` options and `match` targets
 * are shuffled (stable per quiz id) because their authored order is the
 * answer. Pure — the input is not mutated.
 */
export function stripQuizAnswers<T extends Pick<LessonDoc, 'content'>>(
  doc: T,
): T {
  const copy = JSON.parse(JSON.stringify(doc)) as T;
  walkBlocks(copy, (node) => {
    if (node.type !== 'quiz') return;
    const attrs = (node as QuizNode).attrs as Partial<QuizAttrs>;
    const key = attrs.correctOptionIds ?? [];
    if (attrs.kind === 'order' && Array.isArray(attrs.options)) {
      // Shuffle relative to the correct order, not the stored order.
      const byId = new Map(attrs.options.map((o) => [o.id, o]));
      const correct = key
        .map((id) => byId.get(id))
        .filter((o): o is QuizOption => !!o);
      const base =
        correct.length === attrs.options.length ? correct : attrs.options;
      attrs.options = stableShuffle(base, `${attrs.id ?? ''}:order`);
    }
    if (attrs.kind === 'match' && Array.isArray(attrs.targets)) {
      // Targets in option order (the key) → shuffled.
      const pairs = new Map(
        key
          .map(parseMatchToken)
          .filter((p): p is [string, string] => !!p)
          .map(([l, r]) => [r, l] as const),
      );
      const order = new Map((attrs.options ?? []).map((o, i) => [o.id, i]));
      const aligned = [...attrs.targets].sort(
        (a, b) =>
          (order.get(pairs.get(a.id) ?? '') ?? 999) -
          (order.get(pairs.get(b.id) ?? '') ?? 999),
      );
      attrs.targets = stableShuffle(aligned, `${attrs.id ?? ''}:match`);
    }
    delete attrs.correctOptionIds;
    delete attrs.explanation;
  });
  return copy;
}

/** Restrict `answers` to known quizzes / valid tokens (for storage). */
export function sanitizeQuizAnswers(
  doc: Pick<LessonDoc, 'content'>,
  answers: Record<string, unknown> | null | undefined,
): QuizAnswers {
  const out: QuizAnswers = {};
  const given = answers ?? {};
  for (const q of extractQuizzes(doc)) {
    if (!Object.prototype.hasOwnProperty.call(given, q.id)) continue;
    out[q.id] = sanitizeQuizAnswer(q, given[q.id]);
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
 * SHA-256 over (salt, quizId, sorted unique answer tokens). The offline
 * bundle ships one hash per question so the client can give instant
 * feedback without carrying the plain answer key. Because every kind's
 * answer is a token SET, the same function (and the student app's copy in
 * `apps/student/src/app/offline/quiz-hash.ts`) covers match and order too.
 * NOTE: option sets are tiny, so a hash is obfuscation, not secrecy — the
 * server stays authoritative and re-grades every attempt on sync.
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

/** `{ [quizId]: hash(key tokens) }` for every quiz in an authored doc. */
export async function buildQuizAnswerHashes(
  doc: Pick<LessonDoc, 'content'>,
  salt: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const q of extractQuizzes(doc)) {
    if (!q.correctOptionIds) continue;
    out[q.id] = await hashQuizAnswer(salt, q.id, quizKeyTokens(q));
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
