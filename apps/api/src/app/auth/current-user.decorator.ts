import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ApiUser } from './auth.types.js';

/**
 * Param decorator: `@CurrentUser() user: ApiUser`. Returns the request's
 * authenticated user — assumes RolesGuard has already enforced presence,
 * so the type is non-nullable. For routes that may be unauthenticated,
 * read `req.user` directly instead.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      // A @Public() route (or one the guard didn't cover) reached a handler
      // that needs a user: answer 401, never a 500.
      throw new UnauthorizedException('Authentication required');
    }
    return req.user;
  },
);
