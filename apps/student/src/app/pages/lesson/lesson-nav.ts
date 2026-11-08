import type { CourseDetail } from '@codify/api-client';

/** One row of the lesson player's module outline (docs/05 Lesson player). */
export interface OutlineLesson {
  id: string;
  title: string;
  type: string;
  isFree: boolean;
  completed: boolean;
  /** Completion queued offline, waiting to sync. */
  pending: boolean;
  downloaded: boolean;
  current: boolean;
}

export interface OutlineModule {
  id: string;
  title: string;
  lessons: OutlineLesson[];
}

export interface OutlineState {
  completed: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  downloaded: ReadonlySet<string>;
}

export function buildOutline(
  detail: CourseDetail,
  currentId: string,
  st: OutlineState,
): OutlineModule[] {
  return detail.modules.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      isFree: l.isFree,
      completed: st.completed.has(l.id),
      pending: st.pending.has(l.id),
      downloaded: st.downloaded.has(l.id),
      current: l.id === currentId,
    })),
  }));
}

export interface LessonNeighbours {
  next: { id: string; title: string } | null;
  position: { index: number; total: number } | null;
}

/**
 * Position in the module and the next lesson. Offline, "Next" skips to the
 * next *downloaded* lesson (docs/16 §3) so it never leads to the "not
 * downloaded" state; null when nothing further is on the device.
 */
export function lessonNeighbours(
  detail: CourseDetail,
  lessonId: string,
  opts: { offline: boolean; downloaded: ReadonlySet<string> },
): LessonNeighbours {
  const all = detail.modules.flatMap((m) => m.lessons);
  const idx = all.findIndex((l) => l.id === lessonId);
  const mod = detail.modules.find((m) =>
    m.lessons.some((l) => l.id === lessonId),
  );
  const position = mod
    ? {
        index: mod.lessons.findIndex((l) => l.id === lessonId) + 1,
        total: mod.lessons.length,
      }
    : null;
  if (idx < 0) return { next: null, position };
  const rest = all.slice(idx + 1);
  const n = opts.offline
    ? rest.find((l) => opts.downloaded.has(l.id))
    : rest[0];
  return { next: n ? { id: n.id, title: n.title } : null, position };
}

/** Reader text sizes (lesson settings): scale applied to the lesson body. */
export const TEXT_SCALES = [
  { id: 'sm', scale: 0.9 },
  { id: 'md', scale: 1 },
  { id: 'lg', scale: 1.15 },
  { id: 'xl', scale: 1.3 },
] as const;
export type TextSizeId = (typeof TEXT_SCALES)[number]['id'];

const TEXT_SIZE_KEY = 'codify.lesson.textSize';

export function readTextSize(): TextSizeId {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY);
    return TEXT_SCALES.some((t) => t.id === v) ? (v as TextSizeId) : 'md';
  } catch {
    return 'md';
  }
}

export function writeTextSize(id: TextSizeId): void {
  try {
    localStorage.setItem(TEXT_SIZE_KEY, id);
  } catch {
    /* per-view only */
  }
}

export function textScale(id: TextSizeId): number {
  return TEXT_SCALES.find((t) => t.id === id)?.scale ?? 1;
}
