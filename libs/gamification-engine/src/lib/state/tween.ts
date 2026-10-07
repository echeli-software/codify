import type { WritableSignal } from '@angular/core';

/**
 * Shared counter tween for XpService / CoinService: animates `sig` from its
 * current value to `end` with an ease-out-quart curve (docs/10 §4 "Counter
 * tween … easeOutQuart"). Falls back to an immediate set when there is no
 * `requestAnimationFrame` (SSR, tests without timers) or `durationMs <= 0`.
 *
 * A newer tween on the same signal cancels the older one (the older promise
 * still resolves) so rapid grants never fight over the displayed value.
 */
export function tweenSignal(
  sig: WritableSignal<number>,
  end: number,
  durationMs: number,
  token: { current: number },
): Promise<void> {
  const start = sig();
  const id = ++token.current;
  if (
    start === end ||
    durationMs <= 0 ||
    typeof requestAnimationFrame !== 'function'
  ) {
    sig.set(end);
    return Promise.resolve();
  }
  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  return new Promise((resolve) => {
    const t0 = now();
    const tick = () => {
      if (token.current !== id) {
        resolve();
        return;
      }
      const t = Math.min(1, (now() - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4);
      sig.set(Math.round(start + (end - start) * eased));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export function clampCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
