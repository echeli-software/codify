/**
 * Site branding overrides (docs/04 Settings "Branding"): token → hex colour
 * maps served by `GET /api/site-config`, turned into the `--cdf-color-*`
 * CSS custom properties both apps read. Pure — callers set the properties
 * on `<html>` themselves (`applyBrandingVars`).
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TOKEN = /^[a-z][a-z-]{0,30}$/;

/** `#abc` / `#aabbcc` → `"170, 187, 204"`, or null when not a hex colour. */
export function hexToRgbTriplet(hex: string): string | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * CSS variables for `tokens`. `primary` / `primary-hover` also get their
 * `-rgb` triplets (used for translucent fills and focus rings). Invalid
 * names or values are skipped.
 */
export function brandingVars(
  tokens: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens ?? {})) {
    if (!TOKEN.test(name) || typeof value !== 'string' || !HEX.test(value))
      continue;
    out[`--cdf-color-${name}`] = value;
    if (name === 'primary' || name === 'primary-hover') {
      // `value` already passed HEX, so the triplet is never null here.
      out[`--cdf-color-${name}-rgb`] = hexToRgbTriplet(value) as string;
    }
  }
  return out;
}

/** Minimal style target (an element's `style`). */
export interface StyleTarget {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): string;
}

/**
 * Set the branding variables on `style` (usually
 * `document.documentElement.style`), removing ones a previous call set.
 * Returns the names set, to pass back as `previous` next time.
 */
export function applyBrandingVars(
  style: StyleTarget,
  tokens: Record<string, string> | null | undefined,
  previous: readonly string[] = [],
): string[] {
  const vars = brandingVars(tokens);
  for (const name of previous) if (!(name in vars)) style.removeProperty(name);
  for (const [name, value] of Object.entries(vars))
    style.setProperty(name, value);
  return Object.keys(vars);
}
