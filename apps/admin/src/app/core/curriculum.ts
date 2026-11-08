import type { CourseModuleSummary } from '@codify/api-client';
import { moveItem } from './catalog';

/**
 * Pure curriculum edits for the course editor (docs/04 Course →
 * Curriculum): drag / keyboard moves of modules and lessons (lessons may
 * change module), the reorder request body and "first N lessons free".
 */

export type Curriculum = readonly CourseModuleSummary[];

export function moveModule(
  tree: Curriculum,
  from: number,
  to: number,
): CourseModuleSummary[] {
  return moveItem(tree, from, to);
}

/** Move a lesson within or across modules. Unknown modules → unchanged. */
export function moveLesson(
  tree: Curriculum,
  from: { moduleId: string; index: number },
  to: { moduleId: string; index: number },
): CourseModuleSummary[] {
  const src = tree.find((m) => m.id === from.moduleId);
  const dst = tree.find((m) => m.id === to.moduleId);
  const lesson = src?.lessons[from.index];
  if (!src || !dst || !lesson) return [...tree];
  if (src.id === dst.id)
    return tree.map((m) =>
      m.id === src.id
        ? { ...m, lessons: moveItem(m.lessons, from.index, to.index) }
        : m,
    );
  return tree.map((m) => {
    if (m.id === src.id)
      return { ...m, lessons: m.lessons.filter((_, i) => i !== from.index) };
    if (m.id === dst.id) {
      const lessons = [...m.lessons];
      lessons.splice(
        Math.max(0, Math.min(lessons.length, to.index)),
        0,
        lesson,
      );
      return { ...m, lessons };
    }
    return m;
  });
}

/**
 * Keyboard alternative to dragging a lesson one step: within its module,
 * or across the boundary to the end / start of the neighbouring module.
 * Returns null when the lesson is already at the very top / bottom.
 */
export function stepLesson(
  tree: Curriculum,
  moduleId: string,
  index: number,
  dir: -1 | 1,
): CourseModuleSummary[] | null {
  const mi = tree.findIndex((m) => m.id === moduleId);
  const mod = tree[mi];
  if (!mod) return null;
  const target = index + dir;
  if (target >= 0 && target < mod.lessons.length)
    return moveLesson(tree, { moduleId, index }, { moduleId, index: target });
  const neighbour = tree[mi + dir];
  if (!neighbour) return null;
  return moveLesson(
    tree,
    { moduleId, index },
    {
      moduleId: neighbour.id,
      index: dir === 1 ? 0 : neighbour.lessons.length,
    },
  );
}

/** Body for `PUT /courses/:id/curriculum/order`. */
export function orderBody(tree: Curriculum): {
  modules: { id: string; lessonIds: string[] }[];
} {
  return {
    modules: tree.map((m) => ({
      id: m.id,
      lessonIds: m.lessons.map((l) => l.id),
    })),
  };
}

/** The first `n` lesson ids in curriculum order. */
export function firstLessonIds(tree: Curriculum, n: number): string[] {
  return tree
    .flatMap((m) => m.lessons.map((l) => l.id))
    .slice(0, Math.max(0, n));
}

/** Apply a free set to the tree (every other lesson becomes paid). */
export function withFreeSet(
  tree: Curriculum,
  freeIds: readonly string[],
): CourseModuleSummary[] {
  const free = new Set(freeIds);
  return tree.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({ ...l, isFree: free.has(l.id) })),
  }));
}

/** Renumber `order` fields to match positions (display only). */
export function renumber(tree: Curriculum): CourseModuleSummary[] {
  return tree.map((m, i) => ({
    ...m,
    order: i,
    lessons: m.lessons.map((l, j) => ({ ...l, order: j })),
  }));
}
