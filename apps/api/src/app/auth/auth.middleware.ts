import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  accountBlockFor,
  type AccountLifecycle,
} from '../account/account-state.js';
import { AppConfigService } from '../config/app-config.service.js';
import { UserLifecycleService } from '../engagement/user-lifecycle.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from './auth.types.js';
import {
  type StaffSessionPolicy,
  staffSessionBlockFor,
  staffSessionPolicyFromEnv,
} from './staff-session.js';
import {
  ClerkService,
  type ClerkProfile,
  buildDisplayName,
} from './clerk.service.js';

/** lastSeenAt is refreshed at most this often per user. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

const USER_FIELDS = {
  id: true,
  clerkId: true,
  email: true,
  role: true,
  displayName: true,
  lastSeenAt: true,
  deletedAt: true,
  deletionRequestedAt: true,
  purgedAt: true,
  suspendedAt: true,
} as const;

interface ResolvedRow extends AccountLifecycle {
  id: string;
  clerkId: string;
  email: string;
  role: ApiUser['role'];
  displayName: string;
  lastSeenAt: Date | null;
}

/** A resolved caller plus their account lifecycle state. */
export interface ResolvedAccount {
  user: ApiUser;
  lifecycle: AccountLifecycle;
  /** Verified Clerk session claims (undefined for dev tokens). */
  claims?: Record<string, unknown>;
}

interface NewUserProfile {
  email: string;
  displayName: string;
  role: ApiUser['role'];
}

/**
 * Resolves the caller's `User` from `Authorization: Bearer <token>` and
 * attaches it to `req.user`. Never throws: a missing/invalid token leaves
 * `req.user` undefined and RolesGuard answers 401 for protected routes.
 *
 * Token kinds:
 *  - Clerk session JWT (when CLERK_SECRET_KEY / CLERK_JWT_KEY is set):
 *    verified with @clerk/backend; `sub` maps to `User.clerkId`. A first-
 *    seen subject is provisioned as STUDENT with email/name fetched from the
 *    Clerk Backend API — role claims in the token are never trusted.
 *  - `dev-token-<role>` / `dev-token-studentN`: only when NODE_ENV is not
 *    production AND ALLOW_DEV_AUTH=true.
 *
 * Account lifecycle (docs/14, account/account-state.ts): a soft-deleted
 * account may only call `GET /me/account-status` and `POST /me/restore`;
 * every other request is refused with 403 `ACCOUNT_DELETED`
 * (`restorableUntil` while the 14-day window is open, else null). A
 * suspended account may only call `GET /me/account-status`; everything else
 * is 403 `ACCOUNT_SUSPENDED`. A purged (anonymised) account is treated as
 * unauthenticated. Staff sessions (ADMIN, SUPPORT by default) also need a
 * second factor and a sign-in younger than 12 h (staff-session.ts):
 * 403 `MFA_REQUIRED` / `SESSION_TOO_OLD` except on `GET /me`.
 * `lastSeenAt` is written at most once per
 * LAST_SEEN_INTERVAL_MS per active user, never on every request.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private readonly staffPolicy: StaffSessionPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly clerk: ClerkService,
    /** Welcome + return-from-lapse hooks (docs/10 §3, §13). */
    @Optional() private readonly lifecycle?: UserLifecycleService,
  ) {
    this.staffPolicy = staffSessionPolicyFromEnv({
      STAFF_MFA_ROLES: config.get('STAFF_MFA_ROLES'),
      STAFF_SESSION_MAX_HOURS: config.get('STAFF_SESSION_MAX_HOURS'),
    });
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (token) {
        let account: ResolvedAccount | null = null;
        try {
          account = await this.resolveAccount(token);
        } catch (err) {
          this.logger.warn(`Auth resolution failed: ${(err as Error).message}`);
        }
        if (account) {
          const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
          const block = accountBlockFor(account.lifecycle, req.method, path);
          // Thrown (not next(err)) so Nest's exception filter renders it as
          // problem+json.
          if (block) throw new ForbiddenException(block);
          // ADMIN / SUPPORT: second factor + session < 12 h (docs/14 §1, §18).
          const staff = staffSessionBlockFor(
            account.user.role,
            account.claims,
            req.method,
            path,
            this.staffPolicy,
          );
          if (staff) throw new ForbiddenException(staff);
          req.user = account.user;
        }
      }
    }
    next();
  }

  /** Token → ApiUser of an ACTIVE account (or null). Exposed for tests. */
  async resolve(token: string): Promise<ApiUser | null> {
    const account = await this.resolveAccount(token);
    if (!account) return null;
    const l = account.lifecycle;
    return l.deletedAt || l.suspendedAt ? null : account.user;
  }

  /** Token → caller + lifecycle state (deleted/suspended included), or null. */
  async resolveAccount(token: string): Promise<ResolvedAccount | null> {
    if (token.startsWith('dev-token-')) {
      if (!this.config.devAuthEnabled) return null;
      const stub = parseStubToken(token);
      if (!stub) return null;
      return this.findOrProvision(stub.clerkId, async () => ({
        email: stub.email,
        displayName: stub.displayName,
        role: stub.role,
      }));
    }

    const verified = await this.clerk.verify(token);
    if (!verified) return null;
    const account = await this.findOrProvision(verified.sub, async () => {
      const profile =
        (await this.clerk.fetchProfile(verified.sub)) ??
        profileFromClaims(verified.sub, verified.claims);
      return {
        email: profile.email ?? placeholderEmail(verified.sub),
        displayName: profile.displayName,
        role: 'STUDENT',
      };
    });
    return account ? { ...account, claims: verified.claims } : null;
  }

  private async findOrProvision(
    clerkId: string,
    profile: () => Promise<NewUserProfile>,
  ): Promise<ResolvedAccount | null> {
    let row: ResolvedRow | null = await this.prisma.user.findUnique({
      where: { clerkId },
      select: USER_FIELDS,
    });
    if (!row) {
      row = await this.provision(clerkId, await profile());
      if (row && !row.deletedAt) this.lifecycle?.onCreated(row.id);
    }
    if (!row || row.purgedAt) return null;
    if (!row.deletedAt && !row.suspendedAt) this.touch(row);
    return {
      user: {
        userId: row.id,
        clerkId: row.clerkId,
        email: row.email,
        role: row.role,
        displayName: row.displayName,
      },
      lifecycle: {
        deletedAt: row.deletedAt ?? null,
        deletionRequestedAt: row.deletionRequestedAt ?? null,
        purgedAt: row.purgedAt ?? null,
        suspendedAt: row.suspendedAt ?? null,
      },
    };
  }

  private async provision(
    clerkId: string,
    p: NewUserProfile,
  ): Promise<ResolvedRow | null> {
    const create = () =>
      this.prisma.user.create({
        data: {
          clerkId,
          email: p.email,
          displayName: p.displayName,
          role: p.role,
          lastSeenAt: new Date(),
        },
        select: USER_FIELDS,
      });
    try {
      return await create();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    // Lost a race with a concurrent first request for the same subject?
    const raced = await this.prisma.user.findUnique({
      where: { clerkId },
      select: USER_FIELDS,
    });
    if (raced) return raced;

    // Email already taken by another account. If that account was
    // soft-deleted (user deleted in Clerk, then signed up again), release
    // the address so the new identity can be provisioned. A live account
    // is never re-linked to a different Clerk subject.
    const holder = await this.prisma.user.findUnique({
      where: { email: p.email },
      select: { id: true, deletedAt: true },
    });
    if (holder?.deletedAt) {
      await this.prisma.user.update({
        where: { id: holder.id },
        data: { email: `deleted+${holder.id}@deleted.codify.invalid` },
      });
      this.logger.log(
        `Released email of soft-deleted user ${holder.id} for new subject ${clerkId}`,
      );
      return create();
    }
    this.logger.warn(
      `Cannot provision ${clerkId}: email already belongs to active user ${holder?.id ?? '(unknown)'}`,
    );
    return null;
  }

  /** Fire-and-forget lastSeenAt refresh, at most once per interval. */
  private touch(row: ResolvedRow): void {
    const now = Date.now();
    if (
      row.lastSeenAt &&
      now - row.lastSeenAt.getTime() < LAST_SEEN_INTERVAL_MS
    )
      return;
    // First request ever → welcome; back after a lapse → reset the
    // reactivation stage (+ welcome-back quest). Fire-and-forget.
    this.lifecycle?.onSeen(
      { id: row.id, lastSeenAt: row.lastSeenAt },
      new Date(now),
    );
    const cutoff = new Date(now - LAST_SEEN_INTERVAL_MS);
    void this.prisma.user
      .updateMany({
        where: {
          id: row.id,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
        },
        data: { lastSeenAt: new Date(now) },
      })
      .catch((err: Error) =>
        this.logger.warn(`lastSeenAt update failed: ${err.message}`),
      );
  }
}

function placeholderEmail(sub: string): string {
  return `${sub.toLowerCase()}@users.clerk.invalid`;
}

/** Fallback when the Backend API is unavailable: optional custom claims. */
function profileFromClaims(
  sub: string,
  claims: Record<string, unknown>,
): ClerkProfile {
  const email =
    typeof claims['email'] === 'string' ? claims['email'].toLowerCase() : null;
  const name = typeof claims['name'] === 'string' ? claims['name'] : null;
  return {
    email,
    displayName: buildDisplayName({
      firstName: name,
      email: email ?? undefined,
      username: sub,
    }),
  };
}

/**
 * Dev-token parser: accepts `dev-token-<role>` and `dev-token-studentN`
 * and returns synthetic user fields. Mirrors libs/auth's `signInAs()`.
 */
export function parseStubToken(token: string): {
  clerkId: string;
  email: string;
  displayName: string;
  role: ApiUser['role'];
} | null {
  if (!token.startsWith('dev-token-')) return null;
  const rest = token.slice('dev-token-'.length).toUpperCase();
  if (
    rest === 'STUDENT' ||
    rest === 'TEACHER' ||
    rest === 'SUPPORT' ||
    rest === 'ADMIN'
  ) {
    return {
      clerkId: `dev-${rest.toLowerCase()}`,
      email: `${rest.toLowerCase()}@codify.local`,
      displayName: defaultDisplayName(rest),
      role: rest,
    };
  }
  // Numbered students (dev-token-student2, …) — multi-user dev testing.
  const numbered = /^STUDENT(\d+)$/.exec(rest);
  if (numbered) {
    const n = numbered[1];
    return {
      clerkId: `dev-student${n}`,
      email: `student${n}@codify.local`,
      displayName: `Student ${n}`,
      role: 'STUDENT',
    };
  }
  return null;
}

function defaultDisplayName(role: ApiUser['role']): string {
  switch (role) {
    case 'STUDENT':
      return 'Maria Souza';
    case 'TEACHER':
      return 'Lucas Professor';
    case 'SUPPORT':
      return 'Suporte';
    case 'ADMIN':
      return 'Admin';
  }
}
