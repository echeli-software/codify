import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthMiddleware } from './auth.middleware.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Bundles the AuthMiddleware + module-wide RolesGuard. The middleware is
 * registered globally in AppModule (configure(consumer) below); the guard
 * is bound via APP_GUARD so every controller picks it up unless they opt
 * out with `@Public()`.
 */
@Module({
  providers: [
    AuthMiddleware,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthMiddleware],
})
export class AuthModule {}
