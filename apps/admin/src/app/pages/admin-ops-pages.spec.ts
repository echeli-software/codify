import { auditQueryFrom } from './audit.page';
import { validateCategory } from './item-categories.page';
import { shiftWeek, utcWeekStart, weekAfterMove } from './leagues.page';
import { lastSeenRange } from './users.page';
import { isPaletteShortcut } from './shell.page';
import { predicateText } from '../shared/badge-test-panel';

describe('auditQueryFrom', () => {
  it('drops blanks and converts dates to ISO bounds', () => {
    const q = auditQueryFrom({
      actorId: ' ',
      action: 'user.',
      entityType: 'User',
      entityId: '',
      from: '2026-11-01',
      to: '',
    });
    expect(q.action).toBe('user.');
    expect(q.entityType).toBe('User');
    expect(q.actorId).toBeUndefined();
    expect(q.to).toBeUndefined();
    expect(q.from).toMatch(/^2026-1[01]-\d\dT/);
  });
});

describe('validateCategory', () => {
  it('checks slug (new only), name and sort order', () => {
    expect(
      validateCategory({ slug: 'Bad Slug', name: '', sortOrder: -1 }, true),
    ).toEqual({
      slug: 'admin.common.invalidSlug',
      name: 'admin.common.required',
      sortOrder: 'admin.common.invalidNumber',
    });
    expect(
      validateCategory(
        { slug: 'Bad Slug', name: 'Hats', sortOrder: '5' },
        false,
      ),
    ).toEqual({});
  });
});

describe('league week navigation', () => {
  it('moves by whole UTC weeks and snaps to the current week', () => {
    expect(shiftWeek('2026-11-02T00:00:00.000Z', -1)).toBe('2026-10-26');
    expect(utcWeekStart(new Date('2026-11-08T23:00:00Z'))).toBe('2026-11-02');
    const now = new Date('2026-11-07T12:00:00Z');
    expect(weekAfterMove('2026-11-02T00:00:00.000Z', -1, now)).toBe(
      '2026-10-26',
    );
    expect(weekAfterMove('2026-10-26T00:00:00.000Z', 1, now)).toBeUndefined();
  });
});

describe('lastSeenRange', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  it('maps presets to ISO bounds', () => {
    expect(lastSeenRange('any', now)).toEqual({});
    expect(lastSeenRange('7d', now)).toEqual({
      lastSeenFrom: '2026-10-31T12:00:00.000Z',
    });
    expect(lastSeenRange('over30d', now)).toEqual({
      lastSeenTo: '2026-10-08T12:00:00.000Z',
    });
  });
});

describe('isPaletteShortcut', () => {
  const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('accepts Cmd-K and Ctrl-K only', () => {
    expect(isPaletteShortcut(ev({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(ev({ key: 'K', metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(ev({ key: 'k' }))).toBe(false);
    expect(
      isPaletteShortcut(ev({ key: 'k', ctrlKey: true, shiftKey: true })),
    ).toBe(false);
  });
});

describe('predicateText', () => {
  it('renders predicates with symbols', () => {
    expect(predicateText({ gte: 10 })).toBe('≥ 10');
    expect(predicateText({ gt: 1, lt: 5 })).toBe('> 1, < 5');
  });
});
