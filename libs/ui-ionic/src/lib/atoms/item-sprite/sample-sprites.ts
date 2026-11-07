/**
 * Inline SVG data URIs standing in for uploaded sprite assets in stories and
 * tests (no network). The API returns a CDN `spriteUrl` in their place.
 */
function svg(body: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`,
  )}`;
}

export const SAMPLE_SPRITE_URLS = {
  crown: svg(
    '<path d="M6 48 10 18l14 14 8-20 8 20 14-14 4 30Z" fill="#f5b700" stroke="#8a6200" stroke-width="3"/>',
  ),
  scarf: svg(
    '<path d="M8 20h48v12H40v24h-12V32H8Z" fill="#d6336c" stroke="#7a1d3f" stroke-width="3"/>',
  ),
  frame: svg(
    '<rect x="3" y="3" width="58" height="58" rx="10" fill="none" stroke="#7048e8" stroke-width="6" stroke-dasharray="8 4"/>',
  ),
} as const;
