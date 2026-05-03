import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Marker directive for the coin-counter target. Apply to the coin badge
 * in the top bar so `coinFly()` knows where to fly the coins to:
 *
 *   <cdf-coin-badge cdfCoinTarget [value]="coins.displayed()" />
 *
 * The directive itself just registers the host element with a global
 * registry. `coinFly(sourceEl, count)` reads the registered element to
 * get the destination point.
 */
@Directive({
  selector: '[cdfCoinTarget]',
})
export class CoinTarget {
  readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    coinTargetRegistry.set(this.el.nativeElement);
  }
}

const coinTargetRegistry = (() => {
  let target: HTMLElement | null = null;
  return {
    set(el: HTMLElement) {
      target = el;
    },
    get(): HTMLElement | null {
      return target;
    },
  };
})();

/**
 * Fire N short-lived "coin" particles from `sourceEl` to the registered
 * `cdfCoinTarget` element. CSS-only (transform + opacity) so it costs
 * one paint per frame and respects compositor layers. Promise resolves
 * when the longest particle lands.
 *
 * No-op when either endpoint is unknown — caller is responsible for
 * gating on `MotionAndSoundService.reducedMotion()`.
 */
export function coinFly(sourceEl: HTMLElement, count = 6): Promise<void> {
  const target = coinTargetRegistry.get();
  if (!target || !sourceEl || typeof document === 'undefined') return Promise.resolve();

  const src = sourceEl.getBoundingClientRect();
  const dst = target.getBoundingClientRect();
  const start = { x: src.left + src.width / 2, y: src.top + src.height / 2 };
  const end = { x: dst.left + dst.width / 2, y: dst.top + dst.height / 2 };

  const layer = ensureLayer();
  const promises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const node = document.createElement('span');
    node.className = 'cdf-coin-fly__particle';
    node.style.cssText = `
      position: fixed;
      left: ${start.x}px;
      top: ${start.y}px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ffd54f, #f59e0b);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 100000;
      will-change: transform, opacity;
    `;
    layer.appendChild(node);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // small lateral jitter so particles don't stack
    const jitterX = (Math.random() - 0.5) * 60;
    const jitterY = (Math.random() - 0.5) * 30;
    const duration = 600 + Math.random() * 250;
    const delay = i * 40;

    promises.push(
      animateNode(node, {
        keyframes: [
          {
            transform: `translate(-50%, -50%) translate(0px, 0px) scale(1)`,
            opacity: '1',
          },
          {
            transform: `translate(-50%, -50%) translate(${dx * 0.4 + jitterX}px, ${dy * 0.2 + jitterY}px) scale(1.1)`,
            opacity: '1',
            offset: 0.5,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.6)`,
            opacity: '0',
          },
        ],
        timing: { duration, delay, fill: 'forwards', easing: 'cubic-bezier(.4,0,.2,1)' },
      }),
    );
  }
  return Promise.all(promises).then(() => undefined);
}

function ensureLayer(): HTMLElement {
  const id = 'cdf-coin-fly-layer';
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = id;
    layer.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:100000;';
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
      // Browsers without WAAPI: bail and remove immediately.
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
