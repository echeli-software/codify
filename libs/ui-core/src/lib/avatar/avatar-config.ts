/**
 * AvatarConfig (docs/08 §5): the free base look stored as JSON on
 * `User.avatarConfig`. Shared by the API (validation) and the renderers
 * (palettes), so both agree on the allowed values.
 */

export const SKIN_TONES = [
  'porcelain',
  'fair',
  'light',
  'tan',
  'olive',
  'brown',
  'dark',
  'deep',
] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

/** Fill colour per skin tone (descriptive labels live in i18n). */
export const SKIN_TONE_HEX: Readonly<Record<SkinTone, string>> = {
  porcelain: '#fbe4d5',
  fair: '#f3d0b5',
  light: '#e8b996',
  tan: '#d39a6a',
  olive: '#b9875a',
  brown: '#93603b',
  dark: '#6b4128',
  deep: '#4a2c1c',
};

export const HAIR_STYLES = [
  'short',
  'medium',
  'long',
  'curly',
  'coily',
  'bald',
  'covered',
] as const;
export type BaseHairStyle = (typeof HAIR_STYLES)[number];

/** Curated hair palette (docs/08 §14: curated to avoid contrast traps). */
export const HAIR_COLORS = [
  '#1f1a17',
  '#4a3123',
  '#7b4b2a',
  '#b5793d',
  '#e2c178',
  '#a8a29e',
  '#b8432f',
  '#6d5bd0',
] as const;

/** Curated eye palette. */
export const EYE_COLORS = [
  '#3b2a20',
  '#6b4a2b',
  '#3f6e4a',
  '#3d6a9e',
  '#6b7280',
  '#8a6d3b',
] as const;

/** Vector base bodies the renderer draws (no external art). */
export const BASE_BODIES = ['classic', 'broad', 'slim'] as const;
export type BaseBodyId = (typeof BASE_BODIES)[number];

/** Renderer poses (docs/08 §4). `cheer` is the celebrate pose. */
export const AVATAR_POSES = ['idle', 'wave', 'cheer', 'study'] as const;
export type AvatarPose = (typeof AVATAR_POSES)[number];

export interface AvatarConfig {
  baseBodyId: BaseBodyId;
  skinTone: SkinTone;
  baseHairStyle: BaseHairStyle;
  baseHairColor: string;
  eyeColor: string;
  /** Preferred pose for profile / dressing room previews. */
  pose: AvatarPose;
}

export const DEFAULT_AVATAR_CONFIG: Readonly<AvatarConfig> = {
  baseBodyId: 'classic',
  skinTone: 'tan',
  baseHairStyle: 'short',
  baseHairColor: HAIR_COLORS[1],
  eyeColor: EYE_COLORS[0],
  pose: 'idle',
};

type FieldRule = { values: readonly string[]; caseInsensitive?: boolean };

const RULES: Readonly<Record<keyof AvatarConfig, FieldRule>> = {
  baseBodyId: { values: BASE_BODIES },
  skinTone: { values: SKIN_TONES },
  baseHairStyle: { values: HAIR_STYLES },
  baseHairColor: { values: HAIR_COLORS, caseInsensitive: true },
  eyeColor: { values: EYE_COLORS, caseInsensitive: true },
  pose: { values: AVATAR_POSES },
};

export const AVATAR_CONFIG_KEYS = Object.keys(RULES) as (keyof AvatarConfig)[];

export type AvatarConfigValidation =
  | { ok: true; value: Partial<AvatarConfig> }
  | { ok: false; errors: string[] };

function match(rule: FieldRule, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hit = rule.values.find((x) =>
    rule.caseInsensitive ? x.toLowerCase() === v.toLowerCase() : x === v,
  );
  return hit ?? null;
}

/**
 * Validate a (partial) config patch: only known keys, each one of its
 * curated values. Colours match case-insensitively and come back in the
 * palette's spelling. Errors are `field: message` strings.
 */
export function validateAvatarConfig(input: unknown): AvatarConfigValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, errors: ['config: must be an object'] };
  const errors: string[] = [];
  const value: Partial<Record<keyof AvatarConfig, string>> = {};
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    const rule = RULES[key as keyof AvatarConfig];
    if (!rule) {
      errors.push(`${key}: unknown avatar setting`);
      continue;
    }
    const hit = match(rule, v);
    if (hit === null)
      errors.push(`${key}: must be one of ${rule.values.join(', ')}`);
    else value[key as keyof AvatarConfig] = hit;
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: value as Partial<AvatarConfig> };
}

/**
 * A complete config from whatever is stored (null, legacy `{ skinTone }`
 * only, or values that are no longer in a palette): valid fields are kept,
 * the rest take the defaults.
 */
export function normalizeAvatarConfig(stored: unknown): AvatarConfig {
  const out: AvatarConfig = { ...DEFAULT_AVATAR_CONFIG };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return out;
  const rec = stored as Record<string, unknown>;
  for (const key of AVATAR_CONFIG_KEYS) {
    const hit = match(RULES[key], rec[key]);
    if (hit !== null) (out as unknown as Record<string, string>)[key] = hit;
  }
  return out;
}

/** A random base look (the dressing room's "Random"); `rng` ∈ [0, 1). */
export function randomAvatarConfig(
  rng: () => number,
  keep: Partial<AvatarConfig> = {},
): AvatarConfig {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
  return {
    baseBodyId: pick(BASE_BODIES),
    skinTone: pick(SKIN_TONES),
    baseHairStyle: pick(HAIR_STYLES),
    baseHairColor: pick(HAIR_COLORS),
    eyeColor: pick(EYE_COLORS),
    pose: pick(AVATAR_POSES),
    ...keep,
  };
}
