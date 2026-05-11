/**
 * DTOs for /api/lessons/:id/complete and /api/courses/:id/progress.
 * No body validation needed on POST — the act of POSTing the completion
 * is the entire request. We reserve a body for Phase 5b offline queue
 * (clientTimestamp etc).
 */

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
}

export interface CourseProgressResponse {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
  items: ProgressItem[];
}
