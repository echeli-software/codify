import { z } from 'zod';

/**
 * Environment contract for the API, validated once at boot (see
 * `loadEnv()` in env.ts). Every variable the platform layer reads is
 * declared here; feature modules owned by other areas may still read
 * their own optional vars from `process.env` — unknown keys are allowed
 * through untouched so adding a feature never breaks boot.
 *
 * Empty strings (`CLERK_SECRET_KEY=` in .env) are treated as "unset".
 *
 * Production rules (superRefine below) enforce the "never silently fall
 * back in production" policy from the worker brief / docs/14: real auth,
 * webhook verification, CORS allowlist, Redis-backed rate limits and FCM
 * credentials are all mandatory when NODE_ENV=production.
 */

const optionalString = z.string().trim().min(1).optional();

const boolFlag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) =>
      v === undefined ? fallback : v === 'true' || v === '1' || v === 'yes',
    );

const commaList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

export const DEV_CORS_ORIGINS = [
  'http://localhost:4201',
  'http://localhost:4202',
  'http://localhost:4400',
  'http://localhost:4401',
];

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),

    DATABASE_URL: z
      .string({ error: 'is required' })
      .trim()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    REDIS_URL: z
      .string()
      .trim()
      .regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL')
      .optional(),

    // ─── Auth ────────────────────────────────────────────────────────────
    /** Dev-only `dev-token-*` bearer tokens. Ignored in production. */
    ALLOW_DEV_AUTH: boolFlag(false),
    CLERK_SECRET_KEY: optionalString,
    /** PEM public key for networkless JWT verification (optional). */
    CLERK_JWT_KEY: optionalString,
    CLERK_PUBLISHABLE_KEY: optionalString,
    /** Comma list of origins allowed in the token's `azp` claim. */
    CLERK_AUTHORIZED_PARTIES: commaList,
    CLERK_WEBHOOK_SIGNING_SECRET: optionalString,

    // ─── HTTP hardening ──────────────────────────────────────────────────
    /** Comma list of allowed browser origins. Dev default: localhost apps. */
    CORS_ORIGINS: commaList,
    /**
     * Express `trust proxy` setting. A hop count (`1` = Cloudflare →
     * API, `2` = Cloudflare → Coolify proxy → API), `true`/`false`, or a
     * comma list of trusted subnets. Default: 1 in production, loopback
     * otherwise.
     */
    TRUST_PROXY: optionalString,

    // ─── Observability ───────────────────────────────────────────────────
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: optionalString,
    SENTRY_RELEASE: optionalString,
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional(),

    // ─── Push (FCM) ──────────────────────────────────────────────────────
    /** Base64-encoded Firebase service-account JSON. */
    FIREBASE_SERVICE_ACCOUNT_JSON: optionalString,

    // ─── Jobs ────────────────────────────────────────────────────────────
    JOBS_ENABLED: boolFlag(true),

    // ─── Rate limiting ───────────────────────────────────────────────────
    /** Dev escape hatch for burst-y seed/probe scripts. Always on in production. */
    THROTTLE_ENABLED: boolFlag(true),
  })
  .loose()
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const need = (key: string, ok: boolean, why: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [key], message: why });
    };
    need(
      'CLERK_SECRET_KEY',
      !!env.CLERK_SECRET_KEY,
      'is required in production (Clerk JWT verification + user lookup)',
    );
    need(
      'CLERK_AUTHORIZED_PARTIES',
      env.CLERK_AUTHORIZED_PARTIES.length > 0,
      'is required in production (comma list of app origins checked against the azp claim)',
    );
    need(
      'CLERK_WEBHOOK_SIGNING_SECRET',
      !!env.CLERK_WEBHOOK_SIGNING_SECRET,
      'is required in production (Clerk webhook signature verification)',
    );
    need(
      'CORS_ORIGINS',
      env.CORS_ORIGINS.length > 0,
      'is required in production (comma list of allowed browser origins)',
    );
    need(
      'REDIS_URL',
      !!env.REDIS_URL,
      'is required in production (shared rate-limit buckets)',
    );
    need(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      !!env.FIREBASE_SERVICE_ACCOUNT_JSON,
      'is required in production (FCM push delivery)',
    );
    need(
      'THROTTLE_ENABLED',
      env.THROTTLE_ENABLED,
      'must not be disabled in production',
    );
    need(
      'ALLOW_DEV_AUTH',
      !env.ALLOW_DEV_AUTH,
      'must not be enabled in production',
    );
  });

export type Env = z.infer<typeof envSchema>;

/** Raised when the environment fails validation; lists every problem. */
export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  - ${i}`).join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse + validate a raw env record. Empty strings count as unset. Throws
 * `EnvValidationError` naming every invalid or missing variable (never the
 * values — they may be secrets).
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v;
  }
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const key = issue.path.join('.') || '(root)';
        const message =
          issue.code === 'invalid_type' && cleaned[key] === undefined
            ? 'is required'
            : issue.message;
        return `${key} ${message}`;
      }),
    );
  }
  return result.data;
}
