import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from './auth.types.js';
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
} as const;

interface ResolvedRow {
  id: string;
  clerkId: string;
  email: string;
  role: ApiUser['role'];
  displayName: string;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
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
 * Soft-deleted users (deletedAt set, e.g. via the Clerk `user.deleted`
 * webhook) are treated as unauthenticated. `lastSeenAt` is written at most
 * once per LAST_SEEN_INTERVAL_MS per user, never on every request.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly clerk: ClerkService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (token) {
        try {
          const user = await this.resolve(token);
          if (user) req.user = user;
        } catch (err) {
          this.logger.warn(`Auth resolution failed: ${(err as Error).message}`);
        }
      }
    }
    next();
  }

  /** Token → ApiUser (or null). Exposed for tests. */
  async resolve(token: string): Promise<ApiUser | null> {
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
    return this.findOrProvision(verified.sub, async () => {
      const profile =
        (await this.clerk.fetchProfile(verified.sub)) ??
        profileFromClaims(verified.sub, verified.claims);
      return {
        email: profile.email ?? placeholderEmail(verified.sub),
        displayName: profile.displayName,
        role: 'STUDENT',
      };
    });
  }

  private async findOrProvision(
    clerkId: string,
    profile: () => Promise<NewUserProfile>,
  ): Promise<ApiUser | null> {
    let row: ResolvedRow | null = await this.prisma.user.findUnique({
      where: { clerkId },
      select: USER_FIELDS,
    });
    if (!row) row = await this.provision(clerkId, await profile());
    if (!row || row.deletedAt) return null;
    this.touch(row);
    return {
      userId: row.id,
      clerkId: row.clerkId,
      email: row.email,
      role: row.role,
      displayName: row.displayName,
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
