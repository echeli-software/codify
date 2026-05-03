import { ICON_NAMES } from './icon.js';

describe('Icon', () => {
  it('exposes a non-empty curated set', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
  });

  it('keeps every name unique', () => {
    const set = new Set(ICON_NAMES);
    expect(set.size).toBe(ICON_NAMES.length);
  });

  it('includes the gamification essentials', () => {
    for (const expected of ['flame', 'sparkles', 'trophy', 'star', 'gift', 'rocket']) {
      expect(ICON_NAMES).toContain(expected);
    }
  });
});
