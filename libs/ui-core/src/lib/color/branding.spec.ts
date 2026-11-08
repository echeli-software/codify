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

  it('keeps variables that are set again and works without a previous list', () => {
    const props = new Map<string, string>();
    const removed: string[] = [];
    const style = {
      setProperty: (n: string, v: string) => void props.set(n, v),
      removeProperty: (n: string) => {
        removed.push(n);
        props.delete(n);
        return '';
      },
    };
    const first = applyBrandingVars(style, { accent: '#111111' });
    expect(first).toEqual(['--cdf-color-accent']);
    applyBrandingVars(style, { accent: '#222222' }, first);
    expect(removed).toEqual([]);
    expect(props.get('--cdf-color-accent')).toBe('#222222');
  });
});
