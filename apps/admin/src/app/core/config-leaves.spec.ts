import { isCoinRateKey, numericLeaves, withLeaves } from './config-leaves';

describe('config leaves', () => {
  it('flattens and rebuilds nested numeric values', () => {
    const v = { READING: { xp: 10, coins: 5 }, QUIZ: { xp: 15, coins: 8 } };
    const leaves = numericLeaves(v)!;
    expect(leaves).toContainEqual({ path: 'READING.coins', value: 5 });
    const next = withLeaves(
      v,
      leaves.map((l) => (l.path === 'QUIZ.coins' ? { ...l, value: 9 } : l)),
    );
    expect(next).toEqual({
      READING: { xp: 10, coins: 5 },
      QUIZ: { xp: 15, coins: 9 },
    });
    expect(numericLeaves(7)).toEqual([{ path: '', value: 7 }]);
    expect(withLeaves(7, [{ path: '', value: 8 }])).toBe(8);
  });

  it('refuses values with non-numeric leaves', () => {
    expect(numericLeaves({ a: 'x' })).toBeNull();
    expect(numericLeaves([1, 2])).toBeNull();
  });

  it('selects coin-rate keys', () => {
    expect(isCoinRateKey('earning.byLessonType')).toBe(true);
    expect(isCoinRateKey('coins.weeklyPoolCap')).toBe(true);
    expect(isCoinRateKey('multiplier.cap')).toBe(false);
  });
});
