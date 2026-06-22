import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { RewardResult, CompletedQuest, UnlockedBadge } from './progress.client.js';

export interface ExerciseTestCase {
  id: string;
  name: string;
  args: unknown[];
  expected: unknown;
}

export interface StudentExercise {
  id: string;
  lessonId: string;
  language: string;
  entryFunction: string;
  starterCode: string;
  visibleTests: ExerciseTestCase[];
  alreadyPassed: boolean;
}

export interface ExerciseTestResult {
  id: string;
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  error?: string;
  runtimeMs?: number;
}

export interface RunResult {
  results: ExerciseTestResult[];
  verdict: string;
  scorePct: number;
}

export interface SubmitResult extends RunResult {
  submissionId: string;
  passed: boolean;
  hiddenRevealed: { id: string; name: string }[];
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

export interface AdminExercise {
  id: string;
  language: string;
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  visibleTestsJson: ExerciseTestCase[];
  hiddenTestsJson: ExerciseTestCase[];
  timeLimitMs: number;
  memoryLimitKb: number;
}

export interface CreateExerciseBody {
  language: string;
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  visibleTests: ExerciseTestCase[];
  hiddenTests: ExerciseTestCase[];
  timeLimitMs?: number;
  memoryLimitKb?: number;
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
    return firstValueFrom(this.http.get<StudentExercise>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise`));
  }
  run(exerciseId: string, code: string): Promise<RunResult> {
    return firstValueFrom(this.http.post<RunResult>(`${this.base}/exercises/${encodeURIComponent(exerciseId)}/run`, { code }, { context: withIdempotency() }));
  }
  submit(exerciseId: string, code: string): Promise<SubmitResult> {
    return firstValueFrom(this.http.post<SubmitResult>(`${this.base}/exercises/${encodeURIComponent(exerciseId)}/submit`, { code }, { context: withIdempotency() }));
  }

  // ─── Admin ───────────────────────────────────────────────────────────
  create(lessonId: string, body: CreateExerciseBody): Promise<AdminExercise> {
    return firstValueFrom(this.http.post<AdminExercise>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise`, body, { context: withIdempotency() }));
  }
  update(id: string, body: Partial<CreateExerciseBody>): Promise<AdminExercise> {
    return firstValueFrom(this.http.patch<AdminExercise>(`${this.base}/exercises/${encodeURIComponent(id)}`, body, { context: withIdempotency() }));
  }
  getAdmin(id: string): Promise<AdminExercise> {
    return firstValueFrom(this.http.get<AdminExercise>(`${this.base}/exercises/${encodeURIComponent(id)}`));
  }
  getAdminByLesson(lessonId: string): Promise<AdminExercise | null> {
    return firstValueFrom(this.http.get<AdminExercise | null>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/exercise/admin`));
  }
  verify(id: string): Promise<RunResult & { ok: boolean }> {
    return firstValueFrom(this.http.post<RunResult & { ok: boolean }>(`${this.base}/exercises/${encodeURIComponent(id)}/verify`, {}, { context: withIdempotency() }));
  }
}
