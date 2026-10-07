import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { uuidV4, withIdempotency } from './idempotency.js';
import type {
  RewardResult,
  CompletedQuest,
  UnlockedBadge,
} from './progress.client.js';

export interface ExerciseTestCase {
  id: string;
  name: string;
  args: unknown[];
  expected: unknown;
}

export interface StudentExercise {
  id: string;
  lessonId: string;
  language: ExerciseLanguage;
  entryFunction: string;
  starterCode: string;
  visibleTests: ExerciseTestCase[];
  alreadyPassed: boolean;
}

export type ExerciseLanguage = 'javascript' | 'typescript' | 'python';

export interface ExerciseTestResult {
  id: string;
  name: string;
  passed: boolean;
  /** Visible tests only — hidden tests never carry actual/expected. */
  actual?: unknown;
  expected?: unknown;
  /** For a failed hidden test this is a generic message. */
  error?: string;
  runtimeMs?: number;
  /**
   * True for hidden tests. Until the submission passes, hidden tests are
   * anonymised (`id: "hidden-1"`, `name: "Hidden test 1"`); on a full pass
   * their real names are shown.
   */
  hidden?: boolean;
}

export type ExerciseVerdict =
  | 'PASS'
  | 'FAIL'
  | 'ERROR'
  | 'TIMEOUT'
  | 'MEMORY'
  | 'RUNTIME';

/** "Run" (visible tests only) and the admin reference check. */
export interface RunResult {
  results: ExerciseTestResult[];
  verdict: ExerciseVerdict;
  scorePct: number;
  /** Compiler / runtime diagnostics for the visible tests. */
  message?: string;
  /** What the code printed to stdout (non-result lines), truncated. */
  stdout?: string;
}

export type SubmissionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETE'
  | 'WORKER_LOST';

/**
 * A submission as returned by POST /exercises/:id/submit and
 * GET /submissions/:id. The result fields are present once `status` is
 * COMPLETE (or WORKER_LOST, with verdict ERROR and a retry `message`).
 */
export interface SubmissionView {
  submissionId: string;
  id: string;
  exerciseId: string;
  status: SubmissionStatus;
  verdict: ExerciseVerdict | null;
  scorePct: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  createdAt: string;
  completedAt: string | null;
  passed?: boolean;
  results?: ExerciseTestResult[];
  /** Hidden test names — only on a full pass. */
  hiddenRevealed?: { id: string; name: string }[];
  /** Student-safe explanation for TIMEOUT / MEMORY / RUNTIME / ERROR verdicts. */
  message?: string;
  /** Present only on the submission that first completed the lesson. */
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

/** @deprecated use SubmissionView — kept as an alias for existing imports. */
export type SubmitResult = SubmissionView;

export function isSubmissionFinal(s: Pick<SubmissionView, 'status'>): boolean {
  return s.status === 'COMPLETE' || s.status === 'WORKER_LOST';
}

export interface AdminExercise {
  id: string;
  language: ExerciseLanguage;
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  visibleTestsJson: ExerciseTestCase[];
  hiddenTestsJson: ExerciseTestCase[];
  timeLimitMs: number;
  memoryLimitKb: number;
  testHarness: string;
}

export interface CreateExerciseBody {
  /** One of ExerciseLanguage; the server 400s anything else (and languages the active runner cannot execute). */
  language: ExerciseLanguage | (string & Record<never, never>);
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  visibleTests: ExerciseTestCase[];
  hiddenTests: ExerciseTestCase[];
  timeLimitMs?: number;
  memoryLimitKb?: number;
  /** Optional custom harness (see docs/12 §5); empty = data-driven runner. */
  testHarness?: string;
}

@Injectable({ providedIn: 'root' })
export class ExercisesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  // ─── Student ─────────────────────────────────────────────────────────
  forLesson(lessonId: string): Promise<StudentExercise> {
    return firstValueFrom(
      this.http.get<StudentExercise>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise`,
      ),
    );
  }
  run(exerciseId: string, code: string): Promise<RunResult> {
    return firstValueFrom(
      this.http.post<RunResult>(
        `${this.base}/exercises/${encodeURIComponent(exerciseId)}/run`,
        { code },
        { context: withIdempotency() },
      ),
    );
  }
  /**
   * Submit for grading (visible + hidden tests). Pass `idempotencyKey` to
   * make a retry return the same submission. The server waits up to ~10 s:
   * the result is usually final (COMPLETE); otherwise `status` is PENDING /
   * RUNNING and the caller polls `getSubmission` (or uses `submitAndWait`).
   */
  submit(
    exerciseId: string,
    code: string,
    idempotencyKey?: string,
  ): Promise<SubmissionView> {
    return firstValueFrom(
      this.http.post<SubmissionView>(
        `${this.base}/exercises/${encodeURIComponent(exerciseId)}/submit`,
        { code },
        { context: withIdempotency(undefined, idempotencyKey) },
      ),
    );
  }
  getSubmission(submissionId: string): Promise<SubmissionView> {
    return firstValueFrom(
      this.http.get<SubmissionView>(
        `${this.base}/submissions/${encodeURIComponent(submissionId)}`,
      ),
    );
  }
  /**
   * Submit, then poll GET /submissions/:id every `pollMs` until final or
   * `timeoutMs` elapses (returns the last, possibly still PENDING, view).
   * One idempotency key covers the whole call, so a retried submit is safe.
   */
  async submitAndWait(
    exerciseId: string,
    code: string,
    opts: { pollMs?: number; timeoutMs?: number; idempotencyKey?: string } = {},
  ): Promise<SubmissionView> {
    const pollMs = opts.pollMs ?? 1000;
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    let view = await this.submit(
      exerciseId,
      code,
      opts.idempotencyKey ?? uuidV4(),
    );
    while (!isSubmissionFinal(view) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      view = await this.getSubmission(view.submissionId);
    }
    return view;
  }

  // ─── Admin ───────────────────────────────────────────────────────────
  create(lessonId: string, body: CreateExerciseBody): Promise<AdminExercise> {
    return firstValueFrom(
      this.http.post<AdminExercise>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise`,
        body,
        { context: withIdempotency() },
      ),
    );
  }
  update(
    id: string,
    body: Partial<CreateExerciseBody>,
  ): Promise<AdminExercise> {
    return firstValueFrom(
      this.http.patch<AdminExercise>(
        `${this.base}/exercises/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }
  getAdmin(id: string): Promise<AdminExercise> {
    return firstValueFrom(
      this.http.get<AdminExercise>(
        `${this.base}/exercises/${encodeURIComponent(id)}`,
      ),
    );
  }
  getAdminByLesson(lessonId: string): Promise<AdminExercise | null> {
    return firstValueFrom(
      this.http.get<AdminExercise | null>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise/admin`,
      ),
    );
  }
  verify(id: string): Promise<RunResult & { ok: boolean }> {
    return firstValueFrom(
      this.http.post<RunResult & { ok: boolean }>(
        `${this.base}/exercises/${encodeURIComponent(id)}/verify`,
        {},
        { context: withIdempotency() },
      ),
    );
  }
}
