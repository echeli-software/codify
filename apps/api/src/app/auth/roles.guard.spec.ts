import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from './roles.decorator.js';
import { PUBLIC_KEY } from './public.decorator.js';
import type { ApiUser } from './auth.types.js';

function makeCtx(user?: ApiUser): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

const adminUser: ApiUser = {
  userId: 'u1',
  clerkId: 'c1',
  email: 'a@x',
  role: 'ADMIN',
  displayName: 'Admin',
};
const studentUser: ApiUser = { ...adminUser, role: 'STUDENT' };

describe('RolesGuard', () => {
  it('allows public routes without a user', () => {
    const guard = new RolesGuard(makeReflector({ [PUBLIC_KEY]: true }));
    expect(guard.canActivate(makeCtx())).toBe(true);
  });

  it('throws 401 when no user attached', () => {
    const guard = new RolesGuard(makeReflector({}));
    expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
  });

  it('allows any authenticated user when no role list set', () => {
    const guard = new RolesGuard(makeReflector({}));
    expect(guard.canActivate(makeCtx(studentUser))).toBe(true);
  });

  it('allows when role matches', () => {
    const guard = new RolesGuard(
      makeReflector({ [ROLES_KEY]: ['ADMIN', 'SUPPORT'] }),
    );
    expect(guard.canActivate(makeCtx(adminUser))).toBe(true);
  });

  it('throws 403 when role mismatched', () => {
    const guard = new RolesGuard(
      makeReflector({ [ROLES_KEY]: ['ADMIN', 'SUPPORT'] }),
    );
    expect(() => guard.canActivate(makeCtx(studentUser))).toThrow(
      ForbiddenException,
    );
  });
});
