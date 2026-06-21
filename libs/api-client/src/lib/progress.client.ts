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
  ): Promise<CompleteLessonResponse> {
    return firstValueFrom(
      this.http.post<CompleteLessonResponse>(
        `${this.config.baseUrl}/lessons/${encodeURIComponent(lessonId)}/complete`,
        {},
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
