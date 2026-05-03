import { getContrastingTextColor, contrastRatio } from './contrast.js';

describe('getContrastingTextColor', () => {
  it('white text on dark backgrounds', () => {
    expect(getContrastingTextColor('#000000')).toBe('#ffffff');
    expect(getContrastingTextColor('#1f2937')).toBe('#ffffff');
  });
  it('black text on light backgrounds', () => {
    expect(getContrastingTextColor('#ffffff')).toBe('#000000');
    expect(getContrastingTextColor('#fde68a')).toBe('#000000');
  });
  it('handles short hex', () => {
    expect(getContrastingTextColor('#fff')).toBe('#000000');
  });
  it('falls back to black on invalid input', () => {
    expect(getContrastingTextColor('not-a-color')).toBe('#000000');
  });
});

describe('contrastRatio', () => {
  it('white vs black = 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });
  it('same color = 1', () => {
    expect(contrastRatio('#7c4dff', '#7c4dff')).toBe(1);
  });
  it('symmetric', () => {
    const a = contrastRatio('#1f2937', '#facc15');
    const b = contrastRatio('#facc15', '#1f2937');
    expect(a).toBeCloseTo(b);
  });
});
