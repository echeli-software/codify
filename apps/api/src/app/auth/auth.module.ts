import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthMiddleware } from './auth.middleware.js';
import { ClerkWebhookController } from './clerk-webhook.controller.js';
import { ClerkWebhookService } from './clerk-webhook.service.js';
import { ClerkService } from './clerk.service.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Bundles the AuthMiddleware (Clerk JWT / dev-token → req.user), the
 * module-wide RolesGuard (APP_GUARD) and the Clerk webhook receiver. The
 * middleware is applied globally in AppModule.configure().
 */
@Module({
  controllers: [ClerkWebhookController],
  providers: [
    ClerkService,
    ClerkWebhookService,
    AuthMiddleware,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthMiddleware, ClerkService],
})
export class AuthModule {}
