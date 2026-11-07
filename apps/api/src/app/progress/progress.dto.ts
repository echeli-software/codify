/**
 * DTOs for /api/lessons/:id/complete and /api/courses/:id/progress.
 * The POST body is optional; the offline queue (docs/16 §7) sends the
 * device time of the completion so the streak credits the right local day.
 */

import { IsISO8601, IsOptional } from 'class-validator';

import type { RewardResult } from '../gamification/gamification.types.js';
import type { CompletedQuest } from '../gamification/quests.service.js';
import type { UnlockedBadge } from '../gamification/badges.service.js';

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

export interface CompleteLessonResponse {
  progress: ProgressItem;
  totals: UserTotals;
  /**
   * Canonical reward the client feeds straight into RewardOrchestrator
   * (XP/coins after multipliers, breakdown, level-up, streak). Absent on
   * the 409 idempotent-replay path.
   */
  reward?: RewardResult;
  /** Daily quests that completed as a result of this completion. */
  questsCompleted?: CompletedQuest[];
  /** Badges unlocked as a result of this completion. */
  badgesUnlocked?: UnlockedBadge[];
}

export interface CourseProgressResponse {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
  items: ProgressItem[];
}

export class CompleteLessonDto {
  /** ISO-8601 device time of the completion (offline sync). ≤ 5 min ahead, ≤ 72 h old. */
  @IsOptional()
  @IsISO8601({ strict: true })
  clientTimestamp?: string;
}
