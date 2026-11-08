import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { mulberry32 } from '@codify/ui-core';
import { animateNode, ensureLayer, rngFrom } from './animate.js';

/**
 * XP sparkles and the streak flame burst (docs/10 §4 "Other primitives"):
 *   - `xpSparkle(sourceEl)` — small glints from the source element to the
 *     registered XP target (`[cdfXpTarget]`, the header XP stat);
 *   - `flameBurst()` — fire particles rising from the registered streak
 *     target (`[cdfStreakTarget]`) when a streak day is saved.
 * CSS/WAAPI only (transform + opacity). Both are no-ops when the user
 * prefers reduced motion, when the endpoint is missing, or outside a DOM —
 * the orchestrator also gates on MotionAndSoundService.
 */

const xpTargets: HTMLElement[] = [];
const streakTargets: HTMLElement[] = [];

/** Marks the XP counter sparkles fly to. Most recently mounted wins. */
@Directive({ selector: '[cdfXpTarget]' })
export class XpTarget {
  constructor() {
    register(xpTargets, inject(ElementRef<HTMLElement>).nativeElement);
  }
}

/** Marks the streak counter the flame burst rises from. */
@Directive({ selector: '[cdfStreakTarget]' })
export class StreakTarget {
  constructor() {
    register(streakTargets, inject(ElementRef<HTMLElement>).nativeElement);
  }
}

function register(list: HTMLElement[], node: HTMLElement): void {
  list.push(node);
  inject(DestroyRef).onDestroy(() => {
    const i = list.lastIndexOf(node);
    if (i >= 0) list.splice(i, 1);
  });
}

export function currentXpTarget(): HTMLElement | null {
  return xpTargets[xpTargets.length - 1] ?? null;
}

export function currentStreakTarget(): HTMLElement | null {
  return streakTargets[streakTargets.length - 1] ?? null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface SparkleParticle {
  jitterX: number;
  jitterY: number;
  size: number;
  durationMs: number;
  delayMs: number;
}

/** Pure: the glints of one sparkle trail (reproducible with a seed). */
export function planSparkles(
  count: number,
  seed?: number | null,
): SparkleParticle[] {
  const rand = rngFrom(seed, mulberry32);
  return Array.from({ length: count }, (_, i) => ({
    jitterX: (rand() - 0.5) * 80,
    jitterY: (rand() - 0.5) * 50,
    size: 6 + rand() * 6,
    durationMs: 550 + rand() * 200,
    delayMs: i * 35,
  }));
}

/** Glints from `sourceEl` to the XP target. Resolves when the last lands. */
export function xpSparkle(
  sourceEl: HTMLElement,
  count = 6,
  opts: { seed?: number | null } = {},
): Promise<void> {
  const target = currentXpTarget();
  if (!target || !sourceEl || typeof document === 'undefined')
    return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();
  const src = sourceEl.getBoundingClientRect();
  const dst = target.getBoundingClientRect();
  const start = { x: src.left + src.width / 2, y: src.top + src.height / 2 };
  const dx = dst.left + dst.width / 2 - start.x;
  const dy = dst.top + dst.height / 2 - start.y;
  const layer = ensureLayer('cdf-sparkle-layer', 100001);
  return Promise.all(
    planSparkles(count, opts.seed).map((p) => {
      const node = document.createElement('span');
      node.className = 'cdf-sparkle__particle';
      node.style.cssText = `
        position: fixed; left: ${start.x}px; top: ${start.y}px;
        width: ${p.size}px; height: ${p.size}px;
        background: var(--cdf-color-xp, #a855f7);
        clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
        transform: translate(-50%, -50%);
        pointer-events: none; will-change: transform, opacity;
      `;
      layer.appendChild(node);
      return animateNode(
        node,
        [
          {
            transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)',
            opacity: '0',
          },
          {
            transform: `translate(-50%, -50%) translate(${dx * 0.3 + p.jitterX}px, ${dy * 0.3 + p.jitterY}px) scale(1.2) rotate(90deg)`,
            opacity: '1',
            offset: 0.35,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.5) rotate(180deg)`,
            opacity: '0',
          },
        ],
        {
          duration: p.durationMs,
          delay: p.delayMs,
          fill: 'forwards',
          easing: 'cubic-bezier(.2,.7,.3,1)',
        },
      );
    }),
  ).then(() => undefined);
}

export interface FlameParticle {
  dx: number;
  rise: number;
  size: number;
  durationMs: number;
  delayMs: number;
  hue: number;
}

/** Pure: the particles of one flame burst. */
export function planFlameBurst(
  count: number,
  seed?: number | null,
): FlameParticle[] {
  const rand = rngFrom(seed, mulberry32);
  return Array.from({ length: count }, (_, i) => ({
    dx: (rand() - 0.5) * 36,
    rise: 30 + rand() * 40,
    size: 5 + rand() * 7,
    durationMs: 500 + rand() * 300,
    delayMs: i * 25,
    hue: 15 + rand() * 30,
  }));
}

/** Fire particles rising from the streak counter ("streak day saved"). */
export function flameBurst(
  count = 10,
  opts: { seed?: number | null; target?: HTMLElement | null } = {},
): Promise<void> {
  const target = opts.target ?? currentStreakTarget();
  if (!target || typeof document === 'undefined') return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const layer = ensureLayer('cdf-sparkle-layer', 100001);
  return Promise.all(
    planFlameBurst(count, opts.seed).map((p) => {
      const node = document.createElement('span');
      node.className = 'cdf-flame__particle';
      node.style.cssText = `
        position: fixed; left: ${x}px; top: ${y}px;
        width: ${p.size}px; height: ${p.size * 1.4}px;
        border-radius: 50% 50% 45% 45%;
        background: radial-gradient(circle at 50% 70%, #ffe08a, hsl(${p.hue} 95% 52%));
        transform: translate(-50%, -50%);
        pointer-events: none; will-change: transform, opacity;
      `;
      layer.appendChild(node);
      return animateNode(
        node,
        [
          { transform: 'translate(-50%, -50%) scale(0.6)', opacity: '0.95' },
          {
            transform: `translate(-50%, -50%) translate(${p.dx}px, ${-p.rise}px) scale(0.2)`,
            opacity: '0',
          },
        ],
        {
          duration: p.durationMs,
          delay: p.delayMs,
          fill: 'forwards',
          easing: 'ease-out',
        },
      );
    }),
  ).then(() => undefined);
}
