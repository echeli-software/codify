/**
 * Color helpers used by avatar item recoloring and accessible text overlays.
 * Pure math, no DOM.
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): RGB | null {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6) return null;
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Choose `#000000` or `#ffffff` for text against a colored background based
 * on WCAG relative-luminance contrast. Defaults to black on parse failure.
 */
export function getContrastingTextColor(bgHex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(bgHex);
  if (!rgb) return '#000000';
  return relativeLuminance(rgb) > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Contrast ratio per WCAG 2.x. Returns a value ≥ 1.
 * Pass two hex colors; order doesn't matter.
 */
export function contrastRatio(aHex: string, bHex: string): number {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
