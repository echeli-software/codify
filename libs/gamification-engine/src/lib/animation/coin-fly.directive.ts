import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { mulberry32 } from '@codify/ui-core';
import { animateNode, ensureLayer, rngFrom } from './animate.js';

/**
 * Marker directive for the coin-counter target. Apply to the coin badge
 * in the top bar so `coinFly()` knows where to fly the coins to:
 *
 *   <cdf-coin-badge cdfCoinTarget [value]="coins.displayed()" />
 *
 * The directive registers the host element with a module registry; the
 * most recently mounted target wins and is unregistered on destroy.
 */
@Directive({
  selector: '[cdfCoinTarget]',
})
export class CoinTarget {
  readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    const node = this.el.nativeElement as HTMLElement;
    coinTargets.push(node);
    inject(DestroyRef).onDestroy(() => {
      const i = coinTargets.lastIndexOf(node);
      if (i >= 0) coinTargets.splice(i, 1);
    });
  }
}

const coinTargets: HTMLElement[] = [];

/** The element coins currently fly to (null when none is mounted). */
export function currentCoinTarget(): HTMLElement | null {
  return coinTargets[coinTargets.length - 1] ?? null;
}

export interface CoinFlyOptions {
  /** Seed for a reproducible trail. Omit for `Math.random`. */
  seed?: number | null;
}

export interface CoinParticle {
  jitterX: number;
  jitterY: number;
  durationMs: number;
  delayMs: number;
}

/**
 * Pure: per-particle jitter/timing for a trail of `count` coins (docs/10
 * §4: 3–7 sprites, ~30–40ms stagger, ~600ms easing).
 */
export function planCoinFly(
  count: number,
  opts: CoinFlyOptions = {},
): CoinParticle[] {
  const rand = rngFrom(opts.seed, mulberry32);
  const out: CoinParticle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      jitterX: (rand() - 0.5) * 60,
      jitterY: (rand() - 0.5) * 30,
      durationMs: 600 + rand() * 250,
      delayMs: i * 40,
    });
  }
  return out;
}

/**
 * Fire N short-lived "coin" particles from `sourceEl` to the registered
 * `cdfCoinTarget` element. CSS-only (transform + opacity) so it costs
 * one paint per frame and respects compositor layers. Promise resolves
 * when the longest particle lands.
 *
 * No-op when either endpoint is unknown — caller is responsible for
 * gating on `MotionAndSoundService.reducedMotion()`.
 */
export function coinFly(
  sourceEl: HTMLElement,
  count = 6,
  opts: CoinFlyOptions = {},
): Promise<void> {
  const target = currentCoinTarget();
  if (!target || !sourceEl || typeof document === 'undefined')
    return Promise.resolve();

  const src = sourceEl.getBoundingClientRect();
  const dst = target.getBoundingClientRect();
  const start = { x: src.left + src.width / 2, y: src.top + src.height / 2 };
  const end = { x: dst.left + dst.width / 2, y: dst.top + dst.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const layer = ensureLayer('cdf-coin-fly-layer', 100000);
  const promises = planCoinFly(count, opts).map((p) => {
    const node = document.createElement('span');
    node.className = 'cdf-coin-fly__particle';
    node.style.cssText = `
      position: fixed;
      left: ${start.x}px;
      top: ${start.y}px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ffd54f, var(--cdf-color-coin, #f59e0b));
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
      transform: translate(-50%, -50%);
      pointer-events: none;
      will-change: transform, opacity;
    `;
    layer.appendChild(node);
    return animateNode(
      node,
      [
        {
          transform: `translate(-50%, -50%) translate(0px, 0px) scale(1)`,
          opacity: '1',
        },
        {
          transform: `translate(-50%, -50%) translate(${dx * 0.4 + p.jitterX}px, ${dy * 0.2 + p.jitterY}px) scale(1.1)`,
          opacity: '1',
          offset: 0.5,
        },
        {
          transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.6)`,
          opacity: '0',
        },
      ],
      {
        duration: p.durationMs,
        delay: p.delayMs,
        fill: 'forwards',
        easing: 'cubic-bezier(.4,0,.2,1)',
      },
    );
  });
  return Promise.all(promises).then(() => undefined);
}
