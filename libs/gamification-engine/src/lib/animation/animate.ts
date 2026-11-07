/** Shared DOM helpers for the CSS/WAAPI particle animations. */

export function ensureLayer(id: string, zIndex: number): HTMLElement {
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = id;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `position:fixed; inset:0; pointer-events:none; z-index:${zIndex};`;
    document.body.appendChild(layer);
  }
  return layer;
}

export function animateNode(
  node: HTMLElement,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions,
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof node.animate !== 'function') {
      // Browsers (or jsdom) without WAAPI: bail and remove immediately.
      node.remove();
      resolve();
      return;
    }
    const a = node.animate(keyframes, timing);
    const done = () => {
      node.remove();
      resolve();
    };
    a.onfinish = done;
    a.oncancel = done;
  });
}

/** `Math.random` fallback when no seed is given. */
export function rngFrom(
  seed: number | null | undefined,
  factory: (seed: number) => () => number,
): () => number {
  return typeof seed === 'number' ? factory(seed) : Math.random;
}
