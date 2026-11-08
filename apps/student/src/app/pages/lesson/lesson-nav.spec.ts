import type { CourseDetail } from '@codify/api-client';
import { buildOutline, lessonNeighbours, textScale } from './lesson-nav';

const detail = {
  id: 'c1',
  slug: 'c',
  modules: [
    {
      id: 'm1',
      order: 0,
      title: 'One',
      lessons: [
        {
          id: 'a',
          order: 0,
          type: 'READING',
          isFree: true,
          estimatedMinutes: 1,
          title: 'A',
        },
        {
          id: 'b',
          order: 1,
          type: 'QUIZ',
          isFree: false,
          estimatedMinutes: 1,
          title: 'B',
        },
      ],
    },
    {
      id: 'm2',
      order: 1,
      title: 'Two',
      lessons: [
        {
          id: 'c',
          order: 0,
          type: 'READING',
          isFree: false,
          estimatedMinutes: 1,
          title: 'C',
        },
      ],
    },
  ],
} as unknown as CourseDetail;

describe('lesson navigation', () => {
  it('finds the module position and the next lesson online', () => {
    expect(
      lessonNeighbours(detail, 'b', { offline: false, downloaded: new Set() }),
    ).toEqual({
      next: { id: 'c', title: 'C' },
      position: { index: 2, total: 2 },
    });
  });

  it('offline, Next skips to the next downloaded lesson', () => {
    expect(
      lessonNeighbours(detail, 'a', {
        offline: true,
        downloaded: new Set(['c']),
      }).next,
    ).toEqual({ id: 'c', title: 'C' });
    expect(
      lessonNeighbours(detail, 'a', { offline: true, downloaded: new Set() })
        .next,
    ).toBeNull();
  });

  it('builds the outline with completion, pending-sync and download marks', () => {
    const out = buildOutline(detail, 'b', {
      completed: new Set(['a']),
      pending: new Set(['b']),
      downloaded: new Set(['a', 'b']),
    });
    expect(
      out[0].lessons.map((l) => [
        l.id,
        l.completed,
        l.pending,
        l.downloaded,
        l.current,
      ]),
    ).toEqual([
      ['a', true, false, true, false],
      ['b', false, true, true, true],
    ]);
    expect(textScale('xl')).toBeGreaterThan(textScale('md'));
  });
});
