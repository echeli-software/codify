import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ClerkClient,
  createClerkClient,
  verifyToken,
} from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { AppConfigService } from '../config/app-config.service.js';

/** Profile fields we mirror from Clerk onto `User`. */
export interface ClerkProfile {
  email: string | null;
  displayName: string;
}

/** Minimal subset of Clerk's webhook `UserJSON` we read. */
export interface ClerkUserJson {
  id: string;
  email_addresses?: { id: string; email_address: string }[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}

const MAX_DISPLAY_NAME = 80;

/** Clerk Backend API base (ban / unban are plain HTTP calls). */
export const CLERK_API_URL = 'https://api.clerk.com';

/** Clerk user ids look like `user_2abc…`; dev-token users (`dev-…`) have none. */
export function isClerkUserId(id: string | null | undefined): id is string {
  return !!id && /^user_[A-Za-z0-9]+$/.test(id);
}

/** Outcome of mirroring a suspension onto the Clerk user. */
export type ClerkBanResult =
  | { status: 'synced' }
  | { status: 'skipped'; reason: 'not_configured' | 'no_clerk_id' }
  | { status: 'failed'; error: string };

export function buildDisplayName(parts: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  const full = [parts.firstName, parts.lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');
  const name =
    full || parts.username?.trim() || parts.email?.split('@')[0] || 'Learner';
  return name.slice(0, MAX_DISPLAY_NAME);
}

/** Profile from a webhook payload (snake_case JSON). */
export function profileFromClerkJson(json: ClerkUserJson): ClerkProfile {
  const emails = json.email_addresses ?? [];
  const primary =
    emails.find((e) => e.id === json.primary_email_address_id) ?? emails[0];
  const email = primary?.email_address?.toLowerCase() ?? null;
  return {
    email,
    displayName: buildDisplayName({
      firstName: json.first_name,
      lastName: json.last_name,
      username: json.username,
      email,
    }),
  };
}

/**
 * Thin seam over @clerk/backend so the middleware + webhook stay testable
 * (jest mocks this class or the SDK). Verification uses the networkless
 * PEM key when `CLERK_JWT_KEY` is set, otherwise JWKS via the secret key.
 * `authorizedParties` (CLERK_AUTHORIZED_PARTIES) pins the `azp` claim to
 * our own app origins so tokens minted for another site are rejected.
 */
@Injectable()
export class ClerkService implements OnModuleInit {
  private readonly logger = new Logger(ClerkService.name);
  private readonly client: ClerkClient | null;

  constructor(private readonly config: AppConfigService) {
    const secretKey = config.get('CLERK_SECRET_KEY');
    this.client = secretKey
      ? createClerkClient({ secretKey, jwtKey: config.get('CLERK_JWT_KEY') })
      : null;
  }

  onModuleInit(): void {
    // Production config validation already guarantees the keys; this
    // re-check protects against a future schema edit loosening it.
    if (this.config.isProduction && !this.enabled) {
      throw new Error(
        'Clerk is not configured: set CLERK_SECRET_KEY (and CLERK_AUTHORIZED_PARTIES) for production.',
      );
    }
    if (!this.enabled && !this.config.devAuthEnabled) {
      this.logger.warn(
        'No authentication configured: set CLERK_SECRET_KEY / CLERK_JWT_KEY, or ALLOW_DEV_AUTH=true for dev tokens.',
      );
    }
  }

  get enabled(): boolean {
    return this.config.clerkEnabled;
  }

  /** Verify a Clerk session JWT. Returns the subject, or null when invalid. */
  async verify(
    token: string,
  ): Promise<{ sub: string; claims: Record<string, unknown> } | null> {
    if (!this.enabled) return null;
    const parties = this.config.get('CLERK_AUTHORIZED_PARTIES');
    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.get('CLERK_SECRET_KEY'),
        jwtKey: this.config.get('CLERK_JWT_KEY'),
        authorizedParties: parties.length ? parties : undefined,
      });
      if (!payload?.sub) return null;
      return {
        sub: payload.sub,
        claims: payload as unknown as Record<string, unknown>,
      };
    } catch (err) {
      this.logger.debug(`Clerk token rejected: ${(err as Error).message}`);
      return null;
    }
  }

  /** Webhook signing secret configured (CLERK_WEBHOOK_SIGNING_SECRET). */
  get webhooksEnabled(): boolean {
    return !!this.config.get('CLERK_WEBHOOK_SIGNING_SECRET');
  }

  /**
   * Verify a Clerk (Svix / Standard Webhooks) delivery against the raw
   * request body using @clerk/backend's `verifyWebhook`. Throws when the
   * signature, timestamp or headers are invalid.
   */
  async verifyWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ type: string; data: Record<string, unknown> }> {
    const secret = this.config.get('CLERK_WEBHOOK_SIGNING_SECRET');
    if (!secret)
      throw new Error('CLERK_WEBHOOK_SIGNING_SECRET is not configured');
    const h = new Headers();
    for (const name of [
      'svix-id',
      'svix-timestamp',
      'svix-signature',
      'content-type',
    ]) {
      const v = headers[name];
      if (typeof v === 'string') h.set(name, v);
    }
    const body =
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const request = new Request('https://api.internal/webhooks/clerk', {
      method: 'POST',
      headers: h,
      body,
    });
    const evt = await verifyWebhook(request, { signingSecret: secret });
    return {
      type: evt.type,
      data: evt.data as unknown as Record<string, unknown>,
    };
  }

  /**
   * Ban (`banned: true`) or unban a user at Clerk — `POST /v1/users/{id}/ban`
   * / `/unban` on the Backend API with the secret key — so a suspended user
   * can't sign in and their sessions are revoked (docs/14 §13). Never
   * throws: without a secret key, or for users with no Clerk id (dev
   * tokens), it is skipped; HTTP / network errors come back as `failed`.
   */
  async setBanned(
    clerkUserId: string | null | undefined,
    banned: boolean,
  ): Promise<ClerkBanResult> {
    const secretKey = this.config.get('CLERK_SECRET_KEY');
    if (!secretKey) {
      this.logger.debug(
        `Clerk not configured — skipping ${banned ? 'ban' : 'unban'} of ${clerkUserId ?? '(none)'}`,
      );
      return { status: 'skipped', reason: 'not_configured' };
    }
    if (!isClerkUserId(clerkUserId)) {
      this.logger.debug(
        `No Clerk user id (${clerkUserId ?? 'none'}) — skipping ${banned ? 'ban' : 'unban'}`,
      );
      return { status: 'skipped', reason: 'no_clerk_id' };
    }
    const url = `${CLERK_API_URL}/v1/users/${encodeURIComponent(clerkUserId)}/${banned ? 'ban' : 'unban'}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { status: 'synced' };
      const body = await res.text().catch(() => '');
      const error = `Clerk ${banned ? 'ban' : 'unban'} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 300)}` : ''}`;
      this.logger.warn(`${error} (user ${clerkUserId})`);
      return { status: 'failed', error };
    } catch (err) {
      const error = `Clerk ${banned ? 'ban' : 'unban'} failed: ${(err as Error).message}`;
      this.logger.warn(`${error} (user ${clerkUserId})`);
      return { status: 'failed', error };
    }
  }

  /**
   * Fetch email + display name for a first-seen subject from the Clerk
   * Backend API. Returns null when no secret key is configured (networkless
   * dev setups) or the lookup fails.
   */
  async fetchProfile(sub: string): Promise<ClerkProfile | null> {
    if (!this.client) return null;
    try {
      const u = await this.client.users.getUser(sub);
      const email =
        u.primaryEmailAddress?.emailAddress?.toLowerCase() ??
        u.emailAddresses[0]?.emailAddress?.toLowerCase() ??
        null;
      return {
        email,
        displayName: buildDisplayName({
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          email,
        }),
      };
    } catch (err) {
      this.logger.warn(
        `Clerk user lookup failed for ${sub}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
