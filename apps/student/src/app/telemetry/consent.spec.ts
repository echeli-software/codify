import {
  CONSENT_KEY,
  consentAllows,
  needsConsentBanner,
  readConsent,
  writeConsent,
} from './consent';

describe('web consent (docs/14 §13)', () => {
  afterEach(() => localStorage.clear());

  it('shows the banner and blocks analytics / error reporting until a choice is made', () => {
    expect(needsConsentBanner(false)).toBe(true);
    expect(consentAllows('analytics', false)).toBe(false);
    expect(consentAllows('errors', false)).toBe(false);
  });

  it('stores granular choices locally', () => {
    writeConsent({ analytics: true, errors: false });
    expect(readConsent()).toMatchObject({
      v: 1,
      analytics: true,
      errors: false,
    });
    expect(consentAllows('analytics', false)).toBe(true);
    expect(consentAllows('errors', false)).toBe(false);
    expect(needsConsentBanner(false)).toBe(false);
  });

  it('native apps follow the store disclosure (no banner, allowed)', () => {
    expect(needsConsentBanner(true)).toBe(false);
    expect(consentAllows('errors', true)).toBe(true);
  });

  it('asks again when the consent version changes', () => {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ v: 0, analytics: true }),
    );
    expect(readConsent()).toBeNull();
  });
});
