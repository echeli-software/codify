import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from '../translations/translations.logic.js';

/**
 * Branding tokens an environment may override (docs/04 Settings
 * "Branding"). Each maps to the `--cdf-color-<token>` CSS variable of
 * libs/ui-tokens; values are hex colours. Kept to the brand colours so an
 * override can't break contrast-tuned surface/text pairs.
 */
export const BRANDING_TOKENS = [
  'primary',
  'primary-hover',
  'primary-active',
  'primary-subtle',
  'primary-on',
  'accent',
  'accent-hover',
  'accent-on',
] as const;
export type BrandingToken = (typeof BRANDING_TOKENS)[number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface BrandingSettings {
  /** token → hex colour, applied to both light and dark themes. */
  tokens: Partial<Record<BrandingToken, string>>;
  /** Optional environment badge text (e.g. "STAGING"), ≤ 24 chars. */
  label: string | null;
}

export interface LocaleSettings {
  /** Locales users may pick; always contains the default locale. */
  enabled: string[];
  default: string;
}

export interface SiteSettings {
  branding: BrandingSettings;
  locales: LocaleSettings;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  branding: { tokens: {}, label: null },
  locales: { enabled: [...SUPPORTED_LOCALES], default: DEFAULT_LOCALE },
};

/** GamificationConfig rows that hold site settings (no schema change). */
export const SITE_SETTING_KEYS = {
  branding: 'site.branding',
  locales: 'site.locales',
} as const;

export function validateBranding(v: unknown): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return ['branding must be an object'];
  const o = v as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(o))
    if (k !== 'tokens' && k !== 'label')
      problems.push(`branding.${k}: unknown field`);
  const tokens = o['tokens'] ?? {};
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens))
    problems.push('branding.tokens must be an object');
  else
    for (const [k, val] of Object.entries(tokens as Record<string, unknown>)) {
      if (!(BRANDING_TOKENS as readonly string[]).includes(k))
        problems.push(`branding.tokens.${k}: unknown token`);
      else if (typeof val !== 'string' || !HEX.test(val))
        problems.push(
          `branding.tokens.${k} must be a hex colour (#rgb / #rrggbb)`,
        );
    }
  const label = o['label'];
  if (
    label !== undefined &&
    label !== null &&
    (typeof label !== 'string' || label.length > 24)
  )
    problems.push('branding.label must be a string of at most 24 characters');
  return problems;
}

export function validateEnabledLocales(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    return ['enabledLocales must be an array of locale codes'];
  const problems: string[] = [];
  for (const l of v)
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(l))
      problems.push(`enabledLocales: ${l} is not a supported locale`);
  if (!v.includes(DEFAULT_LOCALE))
    problems.push(
      `enabledLocales must include the default locale ${DEFAULT_LOCALE}`,
    );
  return problems;
}

/** Stored JSON → settings, falling back to defaults for anything invalid. */
export function coerceSettings(raw: {
  branding?: unknown;
  locales?: unknown;
}): SiteSettings {
  const branding =
    raw.branding !== undefined && validateBranding(raw.branding).length === 0
      ? {
          tokens: { ...((raw.branding as BrandingSettings).tokens ?? {}) },
          label: (raw.branding as BrandingSettings).label ?? null,
        }
      : DEFAULT_SITE_SETTINGS.branding;
  const enabled =
    raw.locales !== undefined &&
    validateEnabledLocales(raw.locales).length === 0
      ? SUPPORTED_LOCALES.filter((l) => (raw.locales as string[]).includes(l))
      : DEFAULT_SITE_SETTINGS.locales.enabled;
  return { branding, locales: { enabled, default: DEFAULT_LOCALE } };
}

/** The enabled locale to use for `requested` (default when disabled). */
export function effectiveLocale(
  requested: string,
  settings: Pick<SiteSettings, 'locales'>,
): string {
  return settings.locales.enabled.includes(requested)
    ? requested
    : settings.locales.default;
}
