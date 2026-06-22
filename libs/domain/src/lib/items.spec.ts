import { evaluatePurchase, isItemAvailable, type ItemEligibilityLike } from './items.js';

const NOW = new Date('2026-06-22T12:00:00Z');
const base: ItemEligibilityLike = {
  costCoins: 100,
  requiredLevel: 1,
  isPremiumOnly: false,
  isLimitedDrop: false,
};

describe('isItemAvailable', () => {
  it('non-limited items are always available', () => {
    expect(isItemAvailable(base, NOW)).toBe(true);
  });
  it('limited drop respects its window', () => {
    const before = { ...base, isLimitedDrop: true, dropStartsAt: '2026-07-01T00:00:00Z' };
    const open = { ...base, isLimitedDrop: true, dropStartsAt: '2026-06-01T00:00:00Z', dropEndsAt: '2026-07-01T00:00:00Z' };
    const past = { ...base, isLimitedDrop: true, dropEndsAt: '2026-06-01T00:00:00Z' };
    expect(isItemAvailable(before, NOW)).toBe(false);
    expect(isItemAvailable(open, NOW)).toBe(true);
    expect(isItemAvailable(past, NOW)).toBe(false);
  });
});

describe('evaluatePurchase', () => {
  const ctx = { userCoins: 500, userLevel: 10, isPremium: false, now: NOW };

  it('ok when affordable, unlocked, available', () => {
    expect(evaluatePurchase({ item: base, owned: false, ...ctx })).toEqual({ canBuy: true, reason: 'ok' });
  });

  it('owned wins over everything', () => {
    expect(evaluatePurchase({ item: base, owned: true, ...ctx }).reason).toBe('owned');
  });

  it('outside drop window → not_available', () => {
    const item = { ...base, isLimitedDrop: true, dropEndsAt: '2026-06-01T00:00:00Z' };
    expect(evaluatePurchase({ item, owned: false, ...ctx }).reason).toBe('not_available');
  });

  it('level gate', () => {
    const item = { ...base, requiredLevel: 20 };
    expect(evaluatePurchase({ item, owned: false, ...ctx }).reason).toBe('level_locked');
  });

  it('premium-only blocks free users even with coins', () => {
    const item = { ...base, isPremiumOnly: true };
    expect(evaluatePurchase({ item, owned: false, ...ctx }).reason).toBe('premium_required');
    expect(evaluatePurchase({ item, owned: false, ...ctx, isPremium: true }).reason).toBe('ok');
  });

  it('insufficient coins', () => {
    const item = { ...base, costCoins: 9999 };
    expect(evaluatePurchase({ item, owned: false, ...ctx }).reason).toBe('insufficient_coins');
  });

  it('priority: level gate reported before premium + coins', () => {
    const item = { ...base, requiredLevel: 50, isPremiumOnly: true, costCoins: 99999 };
    expect(evaluatePurchase({ item, owned: false, ...ctx }).reason).toBe('level_locked');
  });
});
