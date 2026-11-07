import { CursorPager } from './cursor-pager';

describe('CursorPager', () => {
  it('walks forward and back over keyset pages', () => {
    const p = new CursorPager();
    expect(p.page).toBe(1);
    expect(p.canGoBack).toBe(false);
    expect(p.current).toBeUndefined();
    expect(p.forward('c2')).toBe('c2');
    expect(p.forward('c3')).toBe('c3');
    expect(p.page).toBe(3);
    expect(p.back()).toBe('c2');
    expect(p.back()).toBeUndefined();
    expect(p.back()).toBeUndefined();
    expect(p.page).toBe(1);
    p.forward('x');
    p.reset();
    expect(p.page).toBe(1);
  });
});
