import * as Sentry from '@sentry/node';
import { parseEnv } from '../config/env.schema.js';
import { initSentry, reportException, scrubEvent } from './sentry.js';

jest.mock('@sentry/node', () => {
  const scope = { setTag: jest.fn(), setUser: jest.fn(), setExtras: jest.fn() };
  return {
    init: jest.fn(),
    isInitialized: jest.fn(() => true),
    withScope: jest.fn((cb: (s: typeof scope) => void) => cb(scope)),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    flush: jest.fn(),
    __scope: scope,
  };
});

describe('sentry', () => {
  it('does nothing without SENTRY_DSN', () => {
    expect(initSentry(parseEnv({ DATABASE_URL: 'postgres://x' }))).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialises with environment + release from env', () => {
    const ok = initSentry(
      parseEnv({
        DATABASE_URL: 'postgres://x',
        SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'api@1.2.3',
      }),
    );
    expect(ok).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'staging',
        release: 'api@1.2.3',
      }),
    );
  });

  it('scrubs auth headers, bodies and user PII', () => {
    const event = scrubEvent({
      request: {
        headers: {
          Authorization: 'Bearer x',
          cookie: 'a=b',
          'svix-signature': 's',
          accept: 'json',
        },
        data: '{"secret":1}',
        cookies: { a: 'b' },
      },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    });
    expect(event.request?.headers).toEqual({ accept: 'json' });
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('tags exceptions with request id and user id', () => {
    const err = new Error('x');
    reportException(err, { requestId: 'r1', userId: 'u1' });
    const scope = (
      Sentry as unknown as {
        __scope: { setTag: jest.Mock; setUser: jest.Mock };
      }
    ).__scope;
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'r1');
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'u1' });
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});
