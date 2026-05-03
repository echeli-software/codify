/**
 * Tiny confetti burst — 50ish coloured rectangles spawning from a centre
 * point, given gravity and rotation. ~2KB, no dependencies. Picked over
 * tsparticles for v1 to keep the bundle thin; we can swap the impl later
 * without changing the call site since the function takes only a centre
 * and an optional palette.
 *
 *   confettiBurst({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
 *
 * Honor `prefers-reduced-motion` at the call site (orchestrator does so).
 */

const PALETTE_DEFAULT = [
  '#ff3b30', // danger red
  '#ff7a00', // streak orange
  '#ffd54f', // coin yellow
  '#22c55e', // success green
  '#3b82f6', // info blue
  '#a855f7', // primary violet
];

export interface ConfettiOptions {
  x: number;
  y: number;
  /** Number of particles. */
  count?: number;
  /** Animation duration in ms (longest particle). */
  durationMs?: number;
  palette?: string[];
}

export function confettiBurst(opts: ConfettiOptions): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const palette = opts.palette ?? PALETTE_DEFAULT;
  const count = opts.count ?? 60;
  const duration = opts.durationMs ?? 1500;

  const layer = ensureLayer();
  const promises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const node = document.createElement('span');
    const color = palette[i % palette.length];
    const size = 6 + Math.random() * 6;
    node.style.cssText = `
      position: fixed;
      left: ${opts.x}px;
      top: ${opts.y}px;
      width: ${size}px;
      height: ${size * 0.4}px;
      background: ${color};
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 100001;
      will-change: transform, opacity;
      border-radius: 1px;
    `;
    layer.appendChild(node);

    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity - 250; // negative bias so most fly up first
    const rot = (Math.random() - 0.5) * 720;
    const dur = duration * (0.5 + Math.random() * 0.5);

    promises.push(
      animateNode(node, {
        keyframes: [
          { transform: 'translate(-50%, -50%) translate(0,0) rotate(0deg)', opacity: '1' },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy + 200}px) rotate(${rot}deg)`,
            opacity: '1',
            offset: 0.6,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy + 600}px) rotate(${rot * 1.2}deg)`,
            opacity: '0',
          },
        ],
        timing: { duration: dur, fill: 'forwards', easing: 'cubic-bezier(.2,.7,.3,1)' },
      }),
    );
  }
  return Promise.all(promises).then(() => undefined);
}

function ensureLayer(): HTMLElement {
  const id = 'cdf-confetti-layer';
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = id;
    layer.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:100001;';
    document.body.appendChild(layer);
  }
  return layer;
}

function animateNode(
  node: HTMLElement,
  args: { keyframes: Keyframe[]; timing: KeyframeAnimationOptions },
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof node.animate !== 'function') {
      node.remove();
      resolve();
      return;
    }
    const a = node.animate(args.keyframes, args.timing);
    a.onfinish = () => {
      node.remove();
      resolve();
    };
    a.oncancel = () => {
      node.remove();
      resolve();
    };
  });
}
