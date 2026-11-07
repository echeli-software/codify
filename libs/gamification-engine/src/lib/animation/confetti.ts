/**
 * Tiny confetti burst — coloured rectangles spawning from a centre point,
 * given gravity and rotation. ~2KB, no dependencies.
 *
 *   confettiBurst({ x: window.innerWidth / 2, y: window.innerHeight / 3, seed: 42 });
 *
 * Deterministic when `seed` is given (docs/03 "Replaying a sequence is
 * deterministic given a seed"): the particle plan comes from `planConfetti`,
 * a pure function over ui-core's `mulberry32`.
 *
 * Honor `prefers-reduced-motion` at the call site (orchestrator does so).
 */

import { mulberry32 } from '@codify/ui-core';
import { animateNode, ensureLayer, rngFrom } from './animate.js';

const PALETTE_DEFAULT = [
  'var(--cdf-color-danger, #ff3b30)',
  'var(--cdf-color-flame, #f97316)',
  'var(--cdf-color-coin, #f59e0b)',
  'var(--cdf-color-success, #22c55e)',
  'var(--cdf-color-info, #3b82f6)',
  'var(--cdf-color-primary, #a855f7)',
];

export interface ConfettiOptions {
  x: number;
  y: number;
  /** Number of particles. */
  count?: number;
  /** Animation duration in ms (longest particle). */
  durationMs?: number;
  palette?: string[];
  /** Seed for a reproducible burst. Omit for `Math.random`. */
  seed?: number | null;
}

export interface ConfettiParticle {
  color: string;
  size: number;
  dx: number;
  dy: number;
  rotation: number;
  durationMs: number;
}

/** Pure: the exact particles a burst will animate. */
export function planConfetti(
  opts: Omit<ConfettiOptions, 'x' | 'y'>,
): ConfettiParticle[] {
  const rand = rngFrom(opts.seed, mulberry32);
  const palette = opts.palette ?? PALETTE_DEFAULT;
  const count = opts.count ?? 60;
  const duration = opts.durationMs ?? 1500;
  const out: ConfettiParticle[] = [];
  for (let i = 0; i < count; i++) {
    const size = 6 + rand() * 6;
    const angle = rand() * Math.PI * 2;
    const velocity = 200 + rand() * 300;
    out.push({
      color: palette[i % palette.length],
      size,
      dx: Math.cos(angle) * velocity,
      // Negative bias so most particles fly up first.
      dy: Math.sin(angle) * velocity - 250,
      rotation: (rand() - 0.5) * 720,
      durationMs: duration * (0.5 + rand() * 0.5),
    });
  }
  return out;
}

export function confettiBurst(opts: ConfettiOptions): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const layer = ensureLayer('cdf-confetti-layer', 100001);
  const promises = planConfetti(opts).map((p) => {
    const node = document.createElement('span');
    node.style.cssText = `
      position: fixed;
      left: ${opts.x}px;
      top: ${opts.y}px;
      width: ${p.size}px;
      height: ${p.size * 0.4}px;
      background: ${p.color};
      transform: translate(-50%, -50%);
      pointer-events: none;
      will-change: transform, opacity;
      border-radius: 1px;
    `;
    layer.appendChild(node);
    return animateNode(
      node,
      [
        {
          transform: 'translate(-50%, -50%) translate(0,0) rotate(0deg)',
          opacity: '1',
        },
        {
          transform: `translate(-50%, -50%) translate(${p.dx}px, ${p.dy + 200}px) rotate(${p.rotation}deg)`,
          opacity: '1',
          offset: 0.6,
        },
        {
          transform: `translate(-50%, -50%) translate(${p.dx}px, ${p.dy + 600}px) rotate(${p.rotation * 1.2}deg)`,
          opacity: '0',
        },
      ],
      {
        duration: p.durationMs,
        fill: 'forwards',
        easing: 'cubic-bezier(.2,.7,.3,1)',
      },
    );
  });
  return Promise.all(promises).then(() => undefined);
}
