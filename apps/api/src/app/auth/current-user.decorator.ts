import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
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
      throw new Error(
        'CurrentUser used on a route without RolesGuard or a public route',
      );
    }
    return req.user;
  },
);
