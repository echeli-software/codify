import { DEFAULT_TIME_ZONE, decideTimeZone } from './time-zone';

describe('decideTimeZone', () => {
  it('does nothing when the server already matches the device', () => {
    expect(decideTimeZone('Europe/Lisbon', 'Europe/Lisbon', null)).toBe('none');
    expect(decideTimeZone('Europe/Lisbon', null, null)).toBe('none');
  });

  it('sets the device zone on first sign-in (account still on the default)', () => {
    expect(decideTimeZone(DEFAULT_TIME_ZONE, 'Europe/Lisbon', null)).toBe(
      'auto',
    );
  });

  it('follows the device when this device set the current zone itself', () => {
    expect(
      decideTimeZone('Europe/Lisbon', 'Asia/Tokyo', {
        zone: 'Europe/Lisbon',
        source: 'auto',
      }),
    ).toBe('auto');
  });

  it('asks before overriding a chosen or unknown-origin zone, once per zone', () => {
    expect(
      decideTimeZone('Europe/Lisbon', 'Asia/Tokyo', {
        zone: 'Europe/Lisbon',
        source: 'manual',
      }),
    ).toBe('ask');
    expect(decideTimeZone('Europe/Lisbon', 'Asia/Tokyo', null)).toBe('ask');
    expect(
      decideTimeZone('Europe/Lisbon', 'Asia/Tokyo', {
        zone: 'Europe/Lisbon',
        source: 'manual',
        declined: 'Asia/Tokyo',
      }),
    ).toBe('none');
  });
});
