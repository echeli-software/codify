import { Injectable } from '@nestjs/common';
import type { Env } from './env.schema.js';
import { DEV_CORS_ORIGINS } from './env.schema.js';
import { jobsEnabled, loadEnv } from './env.js';

/**
 * Typed accessor over the validated environment. Inject this instead of
 * reading `process.env` so every value is validated and typed once.
 *
 * Construct with an explicit `Env` in unit tests:
 *   new AppConfigService(parseEnv({ DATABASE_URL: 'postgres://…' }))
 */
@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor(env?: Env) {
    this.env = env ?? loadEnv();
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get port(): number {
    return this.env.API_PORT ?? this.env.PORT ?? 3000;
  }

  /** `dev-token-*` bearer tokens accepted (never in production). */
  get devAuthEnabled(): boolean {
    return !this.isProduction && this.env.ALLOW_DEV_AUTH;
  }

  /** Clerk JWT verification is configured (secret key or networkless PEM). */
  get clerkEnabled(): boolean {
    return !!(this.env.CLERK_SECRET_KEY || this.env.CLERK_JWT_KEY);
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.length > 0
      ? this.env.CORS_ORIGINS
      : DEV_CORS_ORIGINS;
  }

  /** Value for Express' `trust proxy` setting. */
  get trustProxy(): boolean | number | string {
    const raw = this.env.TRUST_PROXY;
    if (raw === undefined) return this.isProduction ? 1 : 'loopback';
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
  }

  get jobsEnabled(): boolean {
    return this.env.JOBS_ENABLED && jobsEnabled();
  }
}
