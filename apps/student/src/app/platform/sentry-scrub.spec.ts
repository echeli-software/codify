import {
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
} from './sentry-scrub';

const JWT =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJlLXZhbHVl';

describe('sentry scrubbing (docs/14 §17)', () => {
  it('removes emails, JWTs, bearer credentials and API keys from text', () => {
    expect(scrubText('failed for ana.maria+x@example.com.br')).toBe(
      'failed for [email]',
    );
    expect(scrubText(`token ${JWT} rejected`)).toBe('token [token] rejected');
    expect(scrubText('Authorization: Bearer abcdefghijklmnop')).toBe(
      'Authorization: Bearer [token]',
    );
    expect(scrubText('key sk_live_abcdefghijklmnopqrstu')).toBe('key [key]');
  });

  it('filters sensitive query parameters and drops fragments', () => {
    expect(
      scrubUrl(
        'https://app.codify.app/r/abc?__clerk_db_jwt=xyz&page=2&email=a%40b.co#frag',
      ),
    ).toBe(
      'https://app.codify.app/r/abc?__clerk_db_jwt=[filtered]&page=2&email=[filtered]',
    );
    expect(scrubUrl('https://x/y')).toBe('https://x/y');
  });

  it('scrubs a whole event: user, request, exceptions, breadcrumbs, extra', () => {
    const event = scrubEvent({
      message: 'oops ana@example.com',
      user: { id: 'u1', email: 'ana@example.com', ip_address: '1.2.3.4' },
      request: {
        url: 'https://admin.codify.app/users?token=abc',
        headers: { Authorization: `Bearer ${JWT}`, Accept: 'json' },
        cookies: { __session: 'x' },
        data: { email: 'ana@example.com' },
        query_string: 'token=abc',
      },
      exception: { values: [{ type: 'Error', value: `bad ${JWT}` }] },
      breadcrumbs: [
        {
          category: 'fetch',
          data: { url: 'https://api.codify.app/api/x?code=123', status: 401 },
        },
        { category: 'console', message: 'user bob@example.org signed in' },
      ],
      extra: {
        body: { email: 'ana@example.com', note: 'mail ana@example.com' },
      },
    });
    expect(event.message).toBe('oops [email]');
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.request).toEqual({
      url: 'https://admin.codify.app/users?token=[filtered]',
      headers: { Accept: 'json' },
    });
    expect(event.exception?.values?.[0]?.value).toBe('bad [token]');
    expect(event.breadcrumbs?.[0]?.data).toEqual({
      url: 'https://api.codify.app/api/x?code=[filtered]',
      status: 401,
    });
    expect(event.breadcrumbs?.[1]?.message).toBe('user [email] signed in');
    expect(event.extra).toEqual({
      body: { email: '[filtered]', note: 'mail [email]' },
    });
  });

  it('scrubs navigation breadcrumbs', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/a?state=s', to: '/b?id=1' },
      }).data,
    ).toEqual({ from: '/a?state=[filtered]', to: '/b?id=1' });
  });
});
