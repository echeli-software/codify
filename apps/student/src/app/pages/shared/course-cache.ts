import type { CourseDetail } from '@codify/api-client';

/**
 * Last-seen course details, kept in localStorage so the course page still
 * renders its curriculum when the device is offline (the lessons
 * themselves come from the download cache). Small: a handful of courses.
 */
const PREFIX = 'codify.courseCache.';
const INDEX = 'codify.courseCache.index';
const MAX = 20;

export interface CachedCourse {
  detail: CourseDetail;
  completedIds: string[];
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveCourse(
  detail: CourseDetail,
  completedIds: Iterable<string>,
): void {
  const s = storage();
  if (!s) return;
  try {
    const entry: CachedCourse = {
      detail,
      completedIds: [...completedIds],
      savedAt: Date.now(),
    };
    const json = JSON.stringify(entry);
    s.setItem(PREFIX + detail.slug, json);
    s.setItem(PREFIX + detail.id, detail.slug);
    const index = (JSON.parse(s.getItem(INDEX) ?? '[]') as string[]).filter(
      (x) => x !== detail.slug,
    );
    index.unshift(detail.slug);
    for (const old of index.splice(MAX)) s.removeItem(PREFIX + old);
    s.setItem(INDEX, JSON.stringify(index));
  } catch {
    // Quota / private mode — the cache is best-effort.
  }
}

/** Cached course by slug or id. */
export function loadCourse(slugOrId: string): CachedCourse | null {
  const s = storage();
  if (!s) return null;
  try {
    let raw = s.getItem(PREFIX + slugOrId);
    if (raw && !raw.startsWith('{')) raw = s.getItem(PREFIX + raw);
    return raw ? (JSON.parse(raw) as CachedCourse) : null;
  } catch {
    return null;
  }
}
