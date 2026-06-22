import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from './auth.types.js';

/**
 * Resolves the caller's `User` row from the Authorization header and
 * attaches it to `req.user`. Today this runs in stub mode: a token of
 * `dev-token-<role>` (matching `libs/auth`'s `signInAs()` output) is
 * accepted and a User is upserted on first sight.
 *
 * In Phase 4b/Clerk we swap the token-decode path for JWKS verification
 * + Clerk subject lookup; the rest of the middleware (User upsert,
 * `req.user` shape) stays the same. That's the contract here.
 *
 * Public endpoints (anything matching `/api/health`, the empty paths, and
 * any path explicitly opted-out via `@Public()` on the controller) are
 * skipped — see app.module.ts where the middleware is wired with
 * `.exclude()`. Errors are non-throwing; missing/invalid tokens just
 * leave `req.user` undefined and protected handlers reject via the guard.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      next();
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const stub = parseStubToken(token);
    if (!stub) {
      // Real-Clerk path goes here in Phase 4b. For now: invalid → no user.
      next();
      return;
    }

    try {
      const user = await this.prisma.user.upsert({
        where: { clerkId: stub.clerkId },
        update: { lastSeenAt: new Date() },
        create: {
          clerkId: stub.clerkId,
          email: stub.email,
          displayName: stub.displayName,
          role: stub.role,
          lastSeenAt: new Date(),
        },
      });
      const apiUser: ApiUser = {
        userId: user.id,
        clerkId: user.clerkId,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      };
      req.user = apiUser;
    } catch (err) {
      // Swallow — leave req.user undefined so guards handle it.
      this.logger.warn(`Auth upsert failed: ${(err as Error).message}`);
    }
    next();
  }
}

/**
 * Stub-mode parser: accepts `dev-token-<role>` and returns synthetic user
 * fields. Mirrors what `libs/auth`'s `signInAs()` writes to localStorage.
 */
function parseStubToken(token: string): {
  clerkId: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
} | null {
  if (!token.startsWith('dev-token-')) return null;
  const rest = token.slice('dev-token-'.length).toUpperCase();
  if (rest === 'STUDENT' || rest === 'TEACHER' || rest === 'SUPPORT' || rest === 'ADMIN') {
    return {
      clerkId: `dev-${rest.toLowerCase()}`,
      email: `${rest.toLowerCase()}@codify.local`,
      displayName: defaultDisplayName(rest),
      role: rest,
    };
  }
  // Numbered students (dev-token-student2, …) — dev-only affordance for
  // multi-user testing (friends, league cohorts at scale). All STUDENT.
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

function defaultDisplayName(role: string): string {
  switch (role) {
    case 'STUDENT':
      return 'Maria Souza';
    case 'TEACHER':
      return 'Lucas Professor';
    case 'SUPPORT':
      return 'Suporte';
    case 'ADMIN':
      return 'Admin';
    default:
      return 'User';
  }
}
