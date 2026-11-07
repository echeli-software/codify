import type { AdminSearchResults } from '@codify/api-client';
import { groupResults, hitLink, moveActive } from './search-palette';

const results: AdminSearchResults = {
  q: 'lo',
  courses: [{ type: 'course', id: 'c1', title: 'Logic', subtitle: 'logic' }],
  lessons: [],
  users: [
    { type: 'user', id: 'u1', title: 'Lola', subtitle: 'lola@x' },
    { type: 'user', id: 'u2', title: 'Lorena', subtitle: 'lo@x' },
  ],
  items: [],
  badges: [{ type: 'badge', id: 'b1', title: 'Loyal', subtitle: 'loyal' }],
};

describe('search palette helpers', () => {
  it('groups non-empty types in order with running indexes', () => {
    const groups = groupResults(results);
    expect(groups.map((g) => g.type)).toEqual(['course', 'user', 'badge']);
    expect(groups.flatMap((g) => g.hits.map((h) => h.index))).toEqual([
      0, 1, 2, 3,
    ]);
    expect(groupResults(null)).toEqual([]);
  });

  it('links each hit type to its admin screen', () => {
    expect(hitLink(results.courses[0])).toEqual({
      commands: ['/courses', 'logic'],
    });
    expect(
      hitLink({ type: 'lesson', id: 'l1', title: 'x', subtitle: 'c' }),
    ).toEqual({ commands: ['/lessons', 'l1'] });
    expect(hitLink(results.users[0])).toEqual({ commands: ['/users', 'u1'] });
    expect(hitLink(results.badges[0])).toEqual({
      commands: ['/gamification'],
      queryParams: { tab: 'badges' },
    });
  });

  it('wraps arrow-key movement', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
