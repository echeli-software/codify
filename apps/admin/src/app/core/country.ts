/** `GET /api/users?country=` value for users without a known country. */
export const COUNTRY_UNKNOWN = 'NONE';

const cache = new Map<string, Intl.DisplayNames | null>();

function regionNames(locale: string): Intl.DisplayNames | null {
  if (!cache.has(locale)) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], {
        type: 'region',
        fallback: 'code',
      });
    } catch {
      names = null;
    }
    cache.set(locale, names);
  }
  return cache.get(locale) ?? null;
}

/**
 * ISO 3166-1 alpha-2 → the country's name in `locale` ("BR" → "Brasil"
 * in pt-BR), falling back to the code itself; null for a missing code.
 */
export function countryName(
  code: string | null | undefined,
  locale: string,
): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  try {
    return regionNames(locale)?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}
