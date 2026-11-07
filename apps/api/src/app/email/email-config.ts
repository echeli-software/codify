import { Logger } from '@nestjs/common';
import { DevEmailProvider, type EmailProvider } from './email.provider.js';
import { ResendEmailProvider } from './resend-email.provider.js';
import { UnsubscribeTokens } from './unsubscribe-token.js';

/** Dev-only signing key; production refuses to boot without its own. */
export const DEV_UNSUBSCRIBE_SECRET = 'codify-dev-unsubscribe-secret';

export const EMAIL_LINKS = Symbol('EMAIL_LINKS');

/** Absolute URLs emails link to. */
export interface EmailLinks {
  /** Student app origin (deep links: `${studentApp}${deepLink}`). */
  studentApp: string;
  /** API base including the `/api` prefix (unsubscribe endpoint). */
  api: string;
}

const isProd = (env: NodeJS.ProcessEnv) => env['NODE_ENV'] === 'production';
const val = (env: NodeJS.ProcessEnv, key: string) => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

/**
 * Email transport: Resend when RESEND_API_KEY + EMAIL_FROM are set, the
 * capturing DevEmailProvider otherwise. Production without them fails at
 * boot (no silent fallback).
 */
export function createEmailProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmailProvider {
  const key = val(env, 'RESEND_API_KEY');
  const from = val(env, 'EMAIL_FROM');
  if (key && from) return new ResendEmailProvider(key, from);
  if (isProd(env)) {
    const missing = [
      ...(key ? [] : ['RESEND_API_KEY']),
      ...(from ? [] : ['EMAIL_FROM']),
    ];
    throw new Error(
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} required in production (transactional email via Resend).`,
    );
  }
  if (key || from) {
    new Logger('EmailModule').warn(
      'RESEND_API_KEY and EMAIL_FROM must both be set — using DevEmailProvider',
    );
  } else {
    new Logger('EmailModule').log(
      'RESEND_API_KEY unset — using DevEmailProvider',
    );
  }
  return new DevEmailProvider();
}

/** Unsubscribe-token signer (EMAIL_UNSUBSCRIBE_SECRET; dev default). */
export function createUnsubscribeTokens(
  env: NodeJS.ProcessEnv = process.env,
): UnsubscribeTokens {
  const secret = val(env, 'EMAIL_UNSUBSCRIBE_SECRET');
  if (secret) return new UnsubscribeTokens(secret);
  if (isProd(env)) {
    throw new Error(
      'EMAIL_UNSUBSCRIBE_SECRET is required in production (signed email unsubscribe links).',
    );
  }
  return new UnsubscribeTokens(DEV_UNSUBSCRIBE_SECRET);
}

export function createEmailLinks(
  env: NodeJS.ProcessEnv = process.env,
): EmailLinks {
  const port = val(env, 'API_PORT') ?? val(env, 'PORT') ?? '3000';
  return {
    studentApp: (
      val(env, 'STUDENT_APP_URL') ??
      (isProd(env) ? 'https://codify.app' : 'http://localhost:4202')
    ).replace(/\/+$/, ''),
    api: (val(env, 'API_PUBLIC_URL') ?? `http://localhost:${port}/api`).replace(
      /\/+$/,
      '',
    ),
  };
}
