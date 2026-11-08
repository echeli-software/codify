import {
  applyBrandingVars,
  brandingVars,
  hexToRgbTriplet,
} from './branding.js';

describe('branding vars', () => {
  it('converts hex colours to rgb triplets', () => {
    expect(hexToRgbTriplet('#ff0066')).toBe('255, 0, 102');
    expect(hexToRgbTriplet('#abc')).toBe('170, 187, 204');
    expect(hexToRgbTriplet('red')).toBeNull();
  });

  it('maps tokens to --cdf-color-* and skips invalid entries', () => {
    expect(
      brandingVars({
        primary: '#ff0066',
        accent: '#00f',
        bad: 'red',
        'X!': '#000',
      }),
    ).toEqual({
      '--cdf-color-primary': '#ff0066',
      '--cdf-color-primary-rgb': '255, 0, 102',
      '--cdf-color-accent': '#00f',
    });
    expect(brandingVars(null)).toEqual({});
  });

  it('applies and clears previously set variables', () => {
    const props = new Map<string, string>();
    const style = {
      setProperty: (n: string, v: string) => void props.set(n, v),
      removeProperty: (n: string) => {
        props.delete(n);
        return '';
      },
    };
    const set = applyBrandingVars(style, { primary: '#123456' });
    expect(props.get('--cdf-color-primary')).toBe('#123456');
    applyBrandingVars(style, {}, set);
    expect(props.size).toBe(0);
  });
});
