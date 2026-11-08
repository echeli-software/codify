import {
  COUNTRY_REFRESH_MS,
  countryUpdate,
  normalizeCountry,
  requestCountry,
} from './client-country.js';
import { CLOUDFLARE_IP_RANGES, viaCloudflare } from './client-ip.js';

const ON = { trustCloudflare: true, cloudflareRanges: CLOUDFLARE_IP_RANGES };
const OFF = { trustCloudflare: false, cloudflareRanges: CLOUDFLARE_IP_RANGES };
const CF_EDGE = '173.245.48.10';
const DIRECT = '203.0.113.5';

describe('normalizeCountry', () => {
  it('accepts two-letter codes and upper-cases them', () => {
    expect(normalizeCountry('BR')).toBe('BR');
    expect(normalizeCountry('us')).toBe('US');
    expect(normalizeCountry(' pt ')).toBe('PT');
    expect(normalizeCountry(['de', 'fr'])).toBe('DE');
  });

  it('ignores unknown (XX), Tor (T1) and anything else', () => {
    for (const v of [
      'XX',
      'xx',
      'T1',
      '',
      ' ',
      'B',
      'BRA',
      'B1',
      '12',
      'É1',
      'ÉU',
      null,
      undefined,
      42,
      [],
    ])
      expect(normalizeCountry(v)).toBeNull();
  });
});

describe('viaCloudflare', () => {
  it('is true only for a Cloudflare edge hop with trust on', () => {
    expect(viaCloudflare({ ip: CF_EDGE }, ON)).toBe(true);
    expect(viaCloudflare({ ip: `::ffff:${CF_EDGE}` }, ON)).toBe(true);
    expect(viaCloudflare({ socket: { remoteAddress: CF_EDGE } }, ON)).toBe(
      true,
    );
    expect(viaCloudflare({ ip: DIRECT }, ON)).toBe(false);
    expect(viaCloudflare({ ip: CF_EDGE }, OFF)).toBe(false);
    expect(viaCloudflare({}, ON)).toBe(false);
  });
});

describe('requestCountry', () => {
  const prod = { devOverride: false, ip: ON };
  const dev = { devOverride: true, ip: ON };

  it('reads CF-IPCountry from a Cloudflare edge', () => {
    expect(
      requestCountry({ ip: CF_EDGE, headers: { 'cf-ipcountry': 'br' } }, prod),
    ).toBe('BR');
  });

  it('ignores CF-IPCountry on a direct-to-origin request', () => {
    expect(
      requestCountry({ ip: DIRECT, headers: { 'cf-ipcountry': 'BR' } }, prod),
    ).toBeNull();
  });

  it('ignores CF-IPCountry when TRUST_CLOUDFLARE is off', () => {
    expect(
      requestCountry(
        { ip: CF_EDGE, headers: { 'cf-ipcountry': 'BR' } },
        { devOverride: false, ip: OFF },
      ),
    ).toBeNull();
  });

  it('drops Tor and unknown codes', () => {
    for (const code of ['T1', 'XX'])
      expect(
        requestCountry(
          { ip: CF_EDGE, headers: { 'cf-ipcountry': code } },
          prod,
        ),
      ).toBeNull();
  });

  it('honours x-dev-country only with the dev override on', () => {
    const req = { ip: '127.0.0.1', headers: { 'x-dev-country': 'pt' } };
    expect(requestCountry(req, dev)).toBe('PT');
    expect(requestCountry(req, prod)).toBeNull();
  });

  it('falls back to Cloudflare when the dev header is unusable', () => {
    expect(
      requestCountry(
        {
          ip: CF_EDGE,
          headers: { 'x-dev-country': 'XX', 'cf-ipcountry': 'AR' },
        },
        dev,
      ),
    ).toBe('AR');
  });

  it('returns null without headers', () => {
    expect(requestCountry({ ip: CF_EDGE }, prod)).toBeNull();
  });
});

describe('countryUpdate', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('writes the first detected country', () => {
    expect(
      countryUpdate({ country: null, countryUpdatedAt: null }, 'BR', now),
    ).toEqual({ country: 'BR', countryUpdatedAt: now });
  });

  it('never clears a known country when nothing was detected', () => {
    expect(
      countryUpdate(
        { country: 'BR', countryUpdatedAt: ago(10 * COUNTRY_REFRESH_MS) },
        null,
        now,
      ),
    ).toBeNull();
  });

  it('refreshes at most once a day', () => {
    const fresh = { country: 'BR', countryUpdatedAt: ago(60_000) };
    expect(countryUpdate(fresh, 'BR', now)).toBeNull();
    // Even a different country waits for the next daily refresh.
    expect(countryUpdate(fresh, 'PT', now)).toBeNull();
    const stale = { country: 'BR', countryUpdatedAt: ago(COUNTRY_REFRESH_MS) };
    expect(countryUpdate(stale, 'PT', now)).toEqual({
      country: 'PT',
      countryUpdatedAt: now,
    });
    // Same country after a day: the timestamp moves on.
    expect(countryUpdate(stale, 'BR', now)).toEqual({
      country: 'BR',
      countryUpdatedAt: now,
    });
  });

  it('writes when a timestamp exists without a country', () => {
    expect(
      countryUpdate({ country: null, countryUpdatedAt: ago(1000) }, 'US', now),
    ).toEqual({ country: 'US', countryUpdatedAt: now });
  });
});
