import { AppConfigService } from './app-config.service.js';
import {
  DEV_CORS_ORIGINS,
  EnvValidationError,
  parseEnv,
} from './env.schema.js';
import { jobsEnabled } from './env.js';

const DB = 'postgresql://u:p@localhost:5432/db';

const PROD_OK = {
  NODE_ENV: 'production',
  DATABASE_URL: DB,
  REDIS_URL: 'redis://localhost:6379',
  CLERK_SECRET_KEY: 'sk_live_x',
  CLERK_AUTHORIZED_PARTIES: 'https://app.codify.app, https://admin.codify.app',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_x',
  CORS_ORIGINS: 'https://app.codify.app,https://admin.codify.app',
  FIREBASE_SERVICE_ACCOUNT_JSON: 'e30=',
};

describe('parseEnv', () => {
  it('accepts a minimal dev env and applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe('development');
    expect(env.ALLOW_DEV_AUTH).toBe(false);
    expect(env.JOBS_ENABLED).toBe(true);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.CLERK_AUTHORIZED_PARTIES).toEqual([]);
  });

  it('treats empty strings as unset and keeps unknown keys', () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      CLERK_SECRET_KEY: '',
      SENTRY_DSN: '  ',
      STRIPE_SECRET_KEY: 'sk',
    });
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect((env as Record<string, unknown>)['STRIPE_SECRET_KEY']).toBe('sk');
  });

  it('parses comma lists and boolean flags', () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      CORS_ORIGINS: 'https://a.test, https://b.test,,',
      ALLOW_DEV_AUTH: 'true',
      JOBS_ENABLED: 'false',
      API_PORT: '3101',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(env.ALLOW_DEV_AUTH).toBe(true);
    expect(env.JOBS_ENABLED).toBe(false);
    expect(env.API_PORT).toBe(3101);
  });

  it('lists every invalid or missing variable at once, without values', () => {
    let error: EnvValidationError | undefined;
    try {
      parseEnv({
        REDIS_URL: 'http://nope',
        API_PORT: 'abc',
        SENTRY_DSN: 'not a url',
      });
    } catch (e) {
      error = e as EnvValidationError;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const joined = error!.issues.join('\n');
    expect(joined).toContain('DATABASE_URL is required');
    expect(joined).toContain('REDIS_URL');
    expect(joined).toContain('API_PORT');
    expect(joined).toContain('SENTRY_DSN');
    expect(error!.message).not.toContain('http://nope');
  });

  it('requires real auth, webhook secret, CORS, Redis and FCM in production', () => {
    let error: EnvValidationError | undefined;
    try {
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: DB,
        ALLOW_DEV_AUTH: 'true',
      });
    } catch (e) {
      error = e as EnvValidationError;
    }
    const keys = error!.issues.map((i) => i.split(' ')[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'CLERK_SECRET_KEY',
        'CLERK_AUTHORIZED_PARTIES',
        'CLERK_WEBHOOK_SIGNING_SECRET',
        'CORS_ORIGINS',
        'REDIS_URL',
        'FIREBASE_SERVICE_ACCOUNT_JSON',
        'ALLOW_DEV_AUTH',
      ]),
    );
  });

  it('accepts a complete production env', () => {
    const env = parseEnv(PROD_OK);
    expect(env.CLERK_AUTHORIZED_PARTIES).toEqual([
      'https://app.codify.app',
      'https://admin.codify.app',
    ]);
  });
});

describe('AppConfigService', () => {
  it('defaults CORS to the localhost dev origins and port to 3000', () => {
    const config = new AppConfigService(parseEnv({ DATABASE_URL: DB }));
    expect(config.corsOrigins).toEqual(DEV_CORS_ORIGINS);
    expect(config.port).toBe(3000);
    expect(config.trustProxy).toBe('loopback');
  });

  it('enables dev auth only outside production with ALLOW_DEV_AUTH=true', () => {
    expect(
      new AppConfigService(parseEnv({ DATABASE_URL: DB })).devAuthEnabled,
    ).toBe(false);
    expect(
      new AppConfigService(
        parseEnv({ DATABASE_URL: DB, ALLOW_DEV_AUTH: 'true' }),
      ).devAuthEnabled,
    ).toBe(true);
    expect(new AppConfigService(parseEnv(PROD_OK)).devAuthEnabled).toBe(false);
  });

  it('reports Clerk enabled with either the secret key or the PEM key', () => {
    expect(
      new AppConfigService(parseEnv({ DATABASE_URL: DB })).clerkEnabled,
    ).toBe(false);
    expect(
      new AppConfigService(parseEnv({ DATABASE_URL: DB, CLERK_JWT_KEY: 'pem' }))
        .clerkEnabled,
    ).toBe(true);
    expect(new AppConfigService(parseEnv(PROD_OK)).clerkEnabled).toBe(true);
  });

  it('parses TRUST_PROXY (hops, booleans, subnet lists) and defaults to 1 hop in production', () => {
    const tp = (v?: string) =>
      new AppConfigService(
        parseEnv({ DATABASE_URL: DB, ...(v ? { TRUST_PROXY: v } : {}) }),
      ).trustProxy;
    expect(tp('2')).toBe(2);
    expect(tp('true')).toBe(true);
    expect(tp('false')).toBe(false);
    expect(tp('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    expect(new AppConfigService(parseEnv(PROD_OK)).trustProxy).toBe(1);
  });
});

describe('jobsEnabled', () => {
  it('is always false under jest', () => {
    expect(jobsEnabled()).toBe(false);
  });
});
