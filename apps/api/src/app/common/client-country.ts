import {
  viaCloudflare,
  type ClientIpOptions,
  type ClientIpRequest,
} from './client-ip.js';

/** `User.country` is refreshed at most this often (docs/02, docs/15 Phase 14). */
export const COUNTRY_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Cloudflare's "unknown" code; `T1` (Tor) fails the two-letter rule. */
const IGNORED_CODES = new Set(['XX']);

/** Dev-only override header (honoured only with ALLOW_DEV_AUTH). */
export const DEV_COUNTRY_HEADER = 'x-dev-country';

/**
 * A `CF-IPCountry` value → ISO 3166-1 alpha-2, upper case, or null for
 * anything else: `XX` (unknown), `T1` (Tor), empty, or not two letters.
 */
export function normalizeCountry(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || IGNORED_CODES.has(code)) return null;
  return code;
}

export interface RequestCountryOptions {
  /** Honour `x-dev-country` (ALLOW_DEV_AUTH on, never in production). */
  devOverride: boolean;
  /** Cloudflare trust options (tests); defaults to the env settings. */
  ip?: ClientIpOptions;
}

/**
 * The caller's country from Cloudflare's `CF-IPCountry`, believed only when
 * the request came through a Cloudflare edge (the same rule `clientIp`
 * uses for `CF-Connecting-IP`), so a direct request to the origin can't
 * set it. In dev, `x-dev-country` stands in for the header.
 */
export function requestCountry(
  req: ClientIpRequest,
  opts: RequestCountryOptions,
): string | null {
  if (opts.devOverride) {
    const dev = normalizeCountry(req.headers?.[DEV_COUNTRY_HEADER]);
    if (dev) return dev;
  }
  if (!viaCloudflare(req, opts.ip)) return null;
  return normalizeCountry(req.headers?.['cf-ipcountry']);
}

export interface StoredCountry {
  country: string | null;
  countryUpdatedAt: Date | null;
}

/**
 * The `User` columns to write for a detected country, or null when nothing
 * should be written: no usable country on this request (keep the last
 * known one), or the stored value is younger than COUNTRY_REFRESH_MS.
 */
export function countryUpdate(
  stored: StoredCountry,
  detected: string | null,
  now: Date,
): { country: string; countryUpdatedAt: Date } | null {
  if (!detected) return null;
  const at = stored.countryUpdatedAt?.getTime();
  if (
    stored.country &&
    at !== undefined &&
    now.getTime() - at < COUNTRY_REFRESH_MS
  )
    return null;
  return { country: detected, countryUpdatedAt: now };
}
