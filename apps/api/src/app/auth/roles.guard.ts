import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ApiUser } from './auth.types.js';
import { ROLES_KEY } from './roles.decorator.js';
import { PUBLIC_KEY } from './public.decorator.js';

/**
 * Module-level guard. Reads `@Public()` and `@Roles(...)` metadata off
 * the handler/class, then:
 *
 *   - public route → allow.
 *   - no `req.user` → 401.
 *   - role list empty → any authenticated user passes.
 *   - role mismatch → 403.
 *
 * Mirrors the client-side `authGuard()` semantics so a route on the API
 * blocks (and surfaces an error code) for the same audience that the
 * Angular guard would have blocked client-side.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Authentication required');

    const required = this.reflector.getAllAndOverride<ApiUser['role'][]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    if (!required.includes(user.role)) {
      throw new ForbiddenException('Role not authorized');
    }
    return true;
  }
}
