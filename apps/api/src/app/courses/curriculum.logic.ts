/**
 * Pure helpers for curriculum editing (docs/04 Course → Curriculum): order
 * planning for the atomic reorder, the "first N lessons free" selection and
 * the duplicate-title suffix. Kept free of Prisma so they unit-test cheaply.
 */

/** Soft-deleted rows are parked here so they never block a live order slot. */
export const PARKED_ORDER_BASE = 1_000_000;

export interface CurrentModule {
  id: string;
  lessonIds: string[];
}

export interface DesiredModule {
  id: string;
  lessonIds: string[];
}

/**
 * Check that `desired` is a permutation of `current`: same module set, and
 * every live lesson of the course appears exactly once (lessons may move
 * between modules). Returns problems; empty = valid.
 */
export function validateCurriculumOrder(
  current: readonly CurrentModule[],
  desired: readonly DesiredModule[],
): string[] {
  const problems: string[] = [];
  const currentModules = new Set(current.map((m) => m.id));
  const desiredModules = desired.map((m) => m.id);
  if (new Set(desiredModules).size !== desiredModules.length)
    problems.push('a module is listed twice');
  if (
    desiredModules.length !== currentModules.size ||
    desiredModules.some((id) => !currentModules.has(id))
  )
    problems.push('modules must list every module of the course exactly once');
  const currentLessons = new Set(current.flatMap((m) => m.lessonIds));
  const desiredLessons = desired.flatMap((m) => m.lessonIds);
  if (new Set(desiredLessons).size !== desiredLessons.length)
    problems.push('a lesson is listed twice');
  const desiredSet = new Set(desiredLessons);
  if (
    desiredLessons.length !== currentLessons.size ||
    desiredLessons.some((id) => !currentLessons.has(id)) ||
    [...currentLessons].some((id) => !desiredSet.has(id))
  )
    problems.push('lessons must list every lesson of the course exactly once');
  return problems;
}

/** Ids of the first `count` lessons in curriculum order. */
export function firstLessons(
  modules: readonly { lessonIds: readonly string[] }[],
  count: number,
): string[] {
  return modules.flatMap((m) => m.lessonIds).slice(0, Math.max(0, count));
}

/** Locale-aware "(copy)" suffix for a duplicated lesson title (≤ 120 chars). */
export function copyTitle(title: string, locale: string): string {
  const suffix = locale.toLowerCase().startsWith('pt') ? ' (cópia)' : ' (copy)';
  return `${title.slice(0, 120 - suffix.length)}${suffix}`;
}
