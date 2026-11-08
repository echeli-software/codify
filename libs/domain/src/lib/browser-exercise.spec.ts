import {
  BROWSER_EXERCISE_CSP,
  buildBrowserSrcdoc,
  gradeBrowserTests,
  validateBrowserTests,
} from './browser-exercise.js';

describe('browser exercises', () => {
  it('wraps a fragment in a document with the CSP and harness first', () => {
    const doc = buildBrowserSrcdoc('<h1>Hi</h1>');
    expect(
      doc.startsWith('<!doctype html><html><head><meta charset="utf-8">'),
    ).toBe(true);
    expect(doc).toContain(BROWSER_EXERCISE_CSP);
    expect(doc.indexOf('codify:run-tests')).toBeLessThan(
      doc.indexOf('<h1>Hi</h1>'),
    );
    expect(BROWSER_EXERCISE_CSP).toContain("default-src 'none'");
  });

  it('injects into an existing <head>', () => {
    const doc = buildBrowserSrcdoc(
      '<!DOCTYPE html><html><head lang="en"><title>x</title></head><body></body></html>',
    );
    expect(
      doc.startsWith('<!DOCTYPE html><html><head lang="en"><meta charset'),
    ).toBe(true);
    expect(doc).toContain('<title>x</title>');
  });

  it('grades probes against expected values', () => {
    const tests = [
      { id: 'a', name: 'A', args: ['text', 'h1'], expected: 'Hi' },
      { id: 'b', name: 'B', args: ['count', 'li'], expected: 3 },
      { id: 'c', name: 'C', args: ['exists', 'p'], expected: true },
    ];
    const res = gradeBrowserTests(tests, [
      { id: 'a', actual: 'Hi' },
      { id: 'b', actual: 2 },
    ]);
    expect(res.map((r) => r.passed)).toEqual([true, false, false]);
    expect(res[2].error).toBe('Not run');
    expect(res[1]).toMatchObject({ actual: 2, expected: 3 });
  });

  it('validates the check names and arity', () => {
    expect(
      validateBrowserTests([
        { id: 'a', args: ['text', 'h1'] },
        { id: 'b', args: ['style', 'h1'] },
        { id: 'c', args: ['bogus'] },
        { id: 'd', args: [] },
      ]),
    ).toEqual([
      'visibleTests[1]: "style" needs 2 argument(s)',
      expect.stringContaining('unknown browser check "bogus"'),
      'visibleTests[3]: args[0] must name a browser check',
    ]);
  });
});
