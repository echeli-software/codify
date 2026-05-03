import { mulberry32, pickSeeded } from './seeded.js';

describe('mulberry32', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });
  it('different seeds → different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
  it('output in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('pickSeeded', () => {
  it('deterministic', () => {
    const items = ['a', 'b', 'c', 'd'] as const;
    expect(pickSeeded(items, 1)).toBe(pickSeeded(items, 1));
  });
  it('throws on empty', () => {
    expect(() => pickSeeded([], 1)).toThrow();
  });
});
