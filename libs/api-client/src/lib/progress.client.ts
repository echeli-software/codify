import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export interface ProgressItem {
  lessonId: string;
  completedAt: string;
  xpAwarded: number;
  coinsAwarded: number;
}

export interface UserTotals {
  totalXp: number;
  coins: number;
}

export interface RewardBreakdownEntry {
  source: string;
  xp?: number;
  coins?: number;
  multiplier?: number;
}

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
}

/** Canonical reward — fed straight into RewardOrchestrator.grant(). */
export interface RewardResult {
  xp: number;
  coins: number;
  multiplier: number;
  xpMultiplier: number;
  coinMultiplier: number;
  breakdown: RewardBreakdownEntry[];
  totals: { totalXp: number; coins: number; level: number };
  levelUp: { newLevel: number; xpForNextLevel: number } | null;
  streak: StreakInfo | null;
  streakMilestone?: { days: number; xp: number; coins: number } | null;
}

export interface CompletedQuest {
  id: string;
  title: string;
  xpReward: number;
  coinReward: number;
}

export interface UnlockedBadge {
  id: string;
  slug: string;
  name: string;
  icon: string;
  description?: string;
}

export interface CompleteLessonResponse {
  progress: ProgressItem;
  totals: UserTotals;
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

/** POST /lessons/:id/complete body. */
export interface CompleteLessonBody {
  /**
   * Device time of an offline completion (ISO-8601), so the streak credits
   * the right local day. Server rejects > 5 min ahead or > 72 h old (400).
   */
  clientTimestamp?: string;
}

export interface CompleteLessonOptions {
  clientTimestamp?: string;
}

/**
 * `code` values on 409 responses from POST /lessons/:id/complete:
 *   - LESSON_ALREADY_COMPLETED: replay; body carries the original progress + totals
 *   - LESSON_COMPLETES_VIA_OWN_FLOW: EXERCISE / AI_PROMPT / SCENARIO / CAPSTONE lesson
 *   - QUIZ_REQUIRES_GRADING: QUIZ lesson with quiz blocks — submit answers instead
 */
export type CompleteLessonConflictCode =
  | 'LESSON_ALREADY_COMPLETED'
  | 'LESSON_COMPLETES_VIA_OWN_FLOW'
  | 'QUIZ_REQUIRES_GRADING';

export interface CourseProgressResponse {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
  items: ProgressItem[];
}

/**
 * Typed client for /api/lessons/:id/complete and /api/courses/:id/progress.
 *
 *   - `complete()` is idempotent server-side. The HTTP status is 201 on
 *     the first call and 200 on replays — but for the typed client both
 *     resolve the same `{ progress, totals }` shape; consumers don't
 *     usually need to distinguish.
 *   - POST `complete()` rides the idempotency interceptor for offline
 *     resilience (Phase 5b will queue these client-side).
 */
@Injectable({ providedIn: 'root' })
export class ProgressClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /**
   * Record completion.  Pass `clientEventId` to pin the
   * `Idempotency-Key` header when replaying a queued offline event —
   * the server uses that value (alongside the (userId, lessonId)
   * unique constraint) to dedupe.
   */
  complete(
    lessonId: string,
    clientEventId?: string,
    opts: CompleteLessonOptions = {},
  ): Promise<CompleteLessonResponse> {
    const body: CompleteLessonBody = {};
    if (opts.clientTimestamp) body.clientTimestamp = opts.clientTimestamp;
    return firstValueFrom(
      this.http.post<CompleteLessonResponse>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(lessonId)}/complete`,
        body,
        { context: withIdempotency(undefined, clientEventId) },
      ),
    );
  }

  forCourse(courseId: string): Promise<CourseProgressResponse> {
    return firstValueFrom(
      this.http.get<CourseProgressResponse>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(courseId)}/progress`,
      ),
    );
  }
}
