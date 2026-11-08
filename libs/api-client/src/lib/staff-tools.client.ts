import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { ApiUserRole } from './types.js';

// ─── Grants (docs/04 Users "Manual grant") ────────────────────────────────

export interface StaffGrantBody {
  coins?: number;
  /** ADMIN only. */
  xp?: number;
  reason: string;
}

export interface StaffGrantResult {
  userId: string;
  coins: number;
  xp: number;
  before: { coins: number; totalXp: number };
  after: { coins: number; totalXp: number };
  remainingToday: { coins: number; xp: number };
}

export interface GrantAllowance {
  usedToday: { coins: number; xp: number };
  limit: { coins: number; xp: number };
  /** SUPPORT: 1,000; ADMIN: null (no per-grant cap). */
  maxCoinsPerGrant: number | null;
}

// ─── Role change (docs/14 §11) ────────────────────────────────────────────

export interface UserRoleChangeResult {
  id: string;
  email: string;
  displayName: string;
  role: ApiUserRole;
  previousRole: ApiUserRole;
  changed: boolean;
}

// ─── SYSTEM notices (docs/10 §3) ──────────────────────────────────────────

export interface TermsAnnouncement {
  version: string;
  audience: number;
  notified: number;
  running: boolean;
}

// ─── Exercise dashboard (docs/12 §11) ─────────────────────────────────────

export type ExerciseFailureVerdict =
  | 'FAIL'
  | 'ERROR'
  | 'TIMEOUT'
  | 'MEMORY'
  | 'RUNTIME';

export interface ExerciseHealthRow {
  exerciseId: string;
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  language: string;
  attempts: number;
  learners: number;
  passers: number;
  /** 0–1, null without learners. */
  passRate: number | null;
  avgAttemptsToPass: number | null;
  failures: Record<ExerciseFailureVerdict, number>;
  topFailingTests: { testId: string; name: string; count: number }[];
}

export interface RetestResult {
  exerciseId: string;
  lessonId: string;
  lessonTitle: string;
  ok: boolean;
  verdict: string | null;
  scorePct: number | null;
  message: string | null;
}

export interface RetestJob {
  jobId: string;
  language: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  actorId: string;
  total: number;
  done: number;
  passed: number;
  failed: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  results: RetestResult[];
}

/**
 * Staff tools: manual coin / XP grants, role change, SYSTEM announcements
 * and the exercise dashboard (`/api/admin/...`).
 */
@Injectable({ providedIn: 'root' })
export class StaffToolsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** ADMIN / SUPPORT (SUPPORT: coins ≤ 1,000, no XP). */
  grant(userId: string, body: StaffGrantBody): Promise<StaffGrantResult> {
    return firstValueFrom(
      this.http.post<StaffGrantResult>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(userId)}/grants`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  grantAllowance(): Promise<GrantAllowance> {
    return firstValueFrom(
      this.http.get<GrantAllowance>(
        `${this.config.baseUrl}/admin/grants/allowance`,
      ),
    );
  }

  /** ADMIN; 403 ROLE_CHANGE_SELF for your own account. */
  changeRole(
    userId: string,
    role: ApiUserRole,
    reason?: string,
  ): Promise<UserRoleChangeResult> {
    return firstValueFrom(
      this.http.patch<UserRoleChangeResult>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(userId)}/role`,
        { role, ...(reason ? { reason } : {}) },
      ),
    );
  }

  announceTerms(body: {
    version: string;
    effectiveDate?: string;
    confirm: 'NOTIFY ALL USERS';
  }): Promise<TermsAnnouncement> {
    return firstValueFrom(
      this.http.post<TermsAnnouncement>(
        `${this.config.baseUrl}/admin/system-notices/terms-update`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  termsStatus(version: string): Promise<TermsAnnouncement> {
    return firstValueFrom(
      this.http.get<TermsAnnouncement>(
        `${this.config.baseUrl}/admin/system-notices/terms-update/${encodeURIComponent(version)}`,
      ),
    );
  }

  exerciseHealth(
    language?: string,
  ): Promise<{ items: ExerciseHealthRow[]; languages: string[] }> {
    return firstValueFrom(
      this.http.get<{ items: ExerciseHealthRow[]; languages: string[] }>(
        `${this.config.baseUrl}/admin/exercise-health`,
        { params: language ? { language } : {} },
      ),
    );
  }

  retests(): Promise<{ items: RetestJob[] }> {
    return firstValueFrom(
      this.http.get<{ items: RetestJob[] }>(
        `${this.config.baseUrl}/admin/exercise-health/retests`,
      ),
    );
  }

  /** Queue a re-run of every reference solution in `language` (202). */
  retest(language: string): Promise<RetestJob> {
    return firstValueFrom(
      this.http.post<RetestJob>(
        `${this.config.baseUrl}/admin/exercise-health/retest`,
        { language },
        { context: withIdempotency() },
      ),
    );
  }
}
