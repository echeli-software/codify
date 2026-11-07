import {
  ProblemDetailsError,
  toProblemDetails,
  type Lesson,
  type QuizAttemptResult,
} from '@codify/api-client';
import type { LessonDoc, QuizAnswers } from '@codify/lesson-schema';
import type { LessonQuizResult } from '@codify/ui-bootstrap';
import type { DownloadedLesson } from '../../offline/download.service.js';

/**
 * Lesson player view states (docs/05 §4):
 *   loading → ready | paywall (402) | notFound (404) | offlineMissing
 *   (offline and not downloaded) | error (anything else, retryable).
 */
export type LessonViewState =
  | 'loading'
  | 'ready'
  | 'paywall'
  | 'notFound'
  | 'offlineMissing'
  | 'error';

export type LoadFailure = 'paywall' | 'notFound' | 'network' | 'error';

export interface RequiredPlan {
  id: string;
  slug: string;
  name: string;
}

/** Map a failed `GET /lessons/:id` to the state to show. */
export function classifyLoadError(err: unknown): LoadFailure {
  const p = err instanceof ProblemDetailsError ? err : toProblemDetails(err);
  if (p.status === 402) return 'paywall';
  if (p.status === 404) return 'notFound';
  if (p.status === 0) return 'network';
  return 'error';
}

/** `requiredPlans` from a 402 problem body (empty when absent). */
export function requiredPlansFrom(err: unknown): RequiredPlan[] {
  const p = err instanceof ProblemDetailsError ? err : toProblemDetails(err);
  const raw = p.data?.['requiredPlans'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is RequiredPlan =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as RequiredPlan).id === 'string',
  );
}

type Block = { type?: string; attrs?: Record<string, unknown> };

function blocks(doc: LessonDoc | null | undefined): Block[] {
  const content = (doc as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

/** Ids of the quiz blocks in a doc, in order. */
export function quizIds(doc: LessonDoc | null | undefined): string[] {
  const ids: string[] = [];
  for (const b of blocks(doc)) {
    const id = b.attrs?.['id'];
    if (b.type === 'quiz' && typeof id === 'string') ids.push(id);
  }
  return ids;
}

/** True when the doc mounts runners through ref blocks. */
export function hasRefBlocks(doc: LessonDoc | null | undefined): boolean {
  return blocks(doc).some(
    (b) =>
      b.type === 'exerciseRef' ||
      b.type === 'aiPromptRef' ||
      b.type === 'scenarioRef',
  );
}

/** True when the doc has anything to render besides ref blocks. */
export function hasReadableContent(doc: LessonDoc | null | undefined): boolean {
  return blocks(doc).length > 0;
}

/** Every quiz in the doc has at least one option picked. */
export function allQuizzesAnswered(
  doc: LessonDoc | null | undefined,
  answers: QuizAnswers,
): boolean {
  const ids = quizIds(doc);
  return ids.length > 0 && ids.every((id) => (answers[id]?.length ?? 0) > 0);
}

/** Lesson types that complete through their own runner, not "Mark complete". */
export function isInteractiveType(type: Lesson['type'] | undefined): boolean {
  return (
    type === 'EXERCISE' ||
    type === 'AI_PROMPT' ||
    type === 'SCENARIO' ||
    type === 'CAPSTONE'
  );
}

/** Server grading → renderer feedback (locks the quizzes). */
export function toQuizView(r: QuizAttemptResult): LessonQuizResult {
  return {
    scorePct: r.scorePct,
    passed: r.passed,
    perQuestion: r.perQuestion.map((q) => ({
      id: q.id,
      correct: q.correct,
      correctOptionIds: q.correctOptionIds ?? [],
      explanation: q.explanation ?? null,
    })),
  };
}

/** Lesson view-model from a downloaded / offline bundle. */
export function lessonFromBundle(c: DownloadedLesson): Lesson {
  return {
    id: c.lessonId,
    moduleId: c.moduleId ?? '',
    courseId: c.courseId,
    order: c.order ?? 0,
    type: c.type as Lesson['type'],
    isFree: c.isFree,
    estimatedMinutes: c.estimatedMinutes ?? 0,
    baseXp: c.baseXp,
    baseCoins: c.baseCoins,
    title: c.title,
    contentJson: c.contentJson,
    createdAt: '',
    updatedAt: c.updatedAt ?? '',
  };
}
