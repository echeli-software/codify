import {
  flameBurst,
  planFlameBurst,
  planSparkles,
  xpSparkle,
} from './sparkle.js';

describe('sparkle + flame primitives', () => {
  it('plans are deterministic with a seed', () => {
    expect(planSparkles(5, 42)).toEqual(planSparkles(5, 42));
    expect(planSparkles(5, 42)).toHaveLength(5);
    expect(planFlameBurst(8, 7)).toEqual(planFlameBurst(8, 7));
    expect(planFlameBurst(8, 7)[3].delayMs).toBe(75);
  });

  it('are no-ops without a registered target', async () => {
    const el = document.createElement('button');
    await expect(xpSparkle(el)).resolves.toBeUndefined();
    await expect(flameBurst()).resolves.toBeUndefined();
    expect(document.getElementById('cdf-sparkle-layer')).toBeNull();
  });

  it('respect prefers-reduced-motion even when called directly', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
    })) as unknown as typeof window.matchMedia;
    try {
      const target = document.createElement('span');
      document.body.appendChild(target);
      await flameBurst(10, { target });
      expect(document.getElementById('cdf-sparkle-layer')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
