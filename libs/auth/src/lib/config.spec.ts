import { isTokenAllowed, safeRedirect } from './config.js';
import { provideAuth } from './provider.js';

describe('safeRedirect', () => {
  it('keeps in-app paths', () => {
    expect(safeRedirect('/today?x=1', '/home')).toBe('/today?x=1');
  });

  it.each([
    null,
    undefined,
    '',
    'today',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
  ])('rejects %p', (target) => {
    expect(safeRedirect(target as string | null, '/home')).toBe('/home');
  });
});

describe('isTokenAllowed', () => {
  const cfg = { apiBaseUrl: 'https://api.codify.app/api/' };
  it('matches the API base and its sub-paths only', () => {
    expect(isTokenAllowed('https://api.codify.app/api', cfg)).toBe(true);
    expect(isTokenAllowed('https://api.codify.app/api/me', cfg)).toBe(true);
    expect(isTokenAllowed('https://api.codify.app/api?x=1', cfg)).toBe(true);
    expect(isTokenAllowed('https://api.codify.app/apix', cfg)).toBe(false);
    expect(isTokenAllowed('https://api.codify.app.evil.com/api/me', cfg)).toBe(
      false,
    );
    expect(isTokenAllowed('/api/me', cfg)).toBe(false);
  });
});

describe('provideAuth', () => {
  it('requires apiBaseUrl with a Clerk key', () => {
    expect(() => provideAuth({ clerkPublishableKey: 'pk' })).toThrow(
      'apiBaseUrl',
    );
    expect(() =>
      provideAuth({ clerkPublishableKey: 'pk', apiBaseUrl: 'http://x/api' }),
    ).not.toThrow();
    expect(() => provideAuth()).not.toThrow();
  });
});
