import type { CourseModuleSummary } from '@codify/api-client';
import {
  firstLessonIds,
  moveLesson,
  moveModule,
  orderBody,
  stepLesson,
  withFreeSet,
} from './curriculum';
import { stableStringify, DirtyTracker } from './dirty';

const lesson = (id: string) => ({
  id,
  order: 0,
  type: 'READING' as const,
  isFree: false,
  estimatedMinutes: 5,
  title: id,
});
const tree: CourseModuleSummary[] = [
  { id: 'm1', order: 0, title: 'M1', lessons: [lesson('a'), lesson('b')] },
  { id: 'm2', order: 1, title: 'M2', lessons: [lesson('c')] },
];
const ids = (t: CourseModuleSummary[] | null) =>
  t?.map((m) => `${m.id}:${m.lessons.map((l) => l.id).join('')}`).join('|');

describe('curriculum moves', () => {
  it('moves modules and lessons (within and across modules)', () => {
    expect(ids(moveModule(tree, 0, 1))).toBe('m2:c|m1:ab');
    expect(
      ids(
        moveLesson(
          tree,
          { moduleId: 'm1', index: 0 },
          { moduleId: 'm1', index: 1 },
        ),
      ),
    ).toBe('m1:ba|m2:c');
    expect(
      ids(
        moveLesson(
          tree,
          { moduleId: 'm1', index: 1 },
          { moduleId: 'm2', index: 0 },
        ),
      ),
    ).toBe('m1:a|m2:bc');
    expect(
      ids(
        moveLesson(
          tree,
          { moduleId: 'x', index: 0 },
          { moduleId: 'm2', index: 0 },
        ),
      ),
    ).toBe('m1:ab|m2:c');
  });

  it('steps lessons across module boundaries with the keyboard', () => {
    expect(ids(stepLesson(tree, 'm1', 1, 1))).toBe('m1:a|m2:bc');
    expect(ids(stepLesson(tree, 'm2', 0, -1))).toBe('m1:abc|m2:');
    expect(stepLesson(tree, 'm1', 0, -1)).toBeNull();
    expect(stepLesson(tree, 'm2', 0, 1)).toBeNull();
  });

  it('builds the reorder body and the first-N free set', () => {
    expect(orderBody(tree)).toEqual({
      modules: [
        { id: 'm1', lessonIds: ['a', 'b'] },
        { id: 'm2', lessonIds: ['c'] },
      ],
    });
    expect(firstLessonIds(tree, 2)).toEqual(['a', 'b']);
    expect(
      withFreeSet(tree, ['c']).flatMap((m) => m.lessons.map((l) => l.isFree)),
    ).toEqual([false, false, true]);
  });
});

describe('DirtyTracker', () => {
  it('ignores key order and tracks changes after mark()', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 1 }] })).toBe(
      stableStringify({ a: [1, { c: 1, d: 2 }], b: 1 }),
    );
    const form = { title: 'x', tags: ['a'] };
    const t = new DirtyTracker(() => form);
    expect(t.isDirty()).toBe(false);
    t.mark();
    expect(t.isDirty()).toBe(false);
    form.tags.push('b');
    expect(t.isDirty()).toBe(true);
    t.clear();
    expect(t.isDirty()).toBe(false);
  });
});
