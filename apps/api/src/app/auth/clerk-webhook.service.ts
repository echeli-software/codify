import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ClerkUserJson, profileFromClerkJson } from './clerk.service.js';

/** The verified event shape we act on (subset of Clerk's WebhookEvent). */
export interface ClerkWebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface ClerkWebhookResult {
  received: true;
  duplicate?: true;
  action:
    | 'user_created'
    | 'user_updated'
    | 'user_deleted'
    | 'session_logged'
    | 'ignored'
    | 'duplicate';
}

const SCOPE = 'clerk_webhook';

/**
 * Applies verified Clerk webhook events. Idempotent per delivery: the svix
 * message id is recorded in `IdempotencyRecord` inside the same transaction
 * as the DB change, so a retried delivery is a no-op and a failed one is
 * retried cleanly.
 *
 *  - user.created / user.updated → mirror email + displayName (role is
 *    never taken from Clerk). user.created provisions the row if the user
 *    hasn't hit the API yet.
 *  - user.deleted → soft-delete (deletedAt) + drop push tokens; the auth
 *    middleware treats soft-deleted users as unauthenticated.
 *  - session.removed / session.ended / session.revoked → log only: the API
 *    is stateless (Clerk JWTs are short-lived), so there is nothing to kill.
 */
@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger(ClerkWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(
    deliveryId: string,
    event: ClerkWebhookEvent,
  ): Promise<ClerkWebhookResult> {
    const key = `clerk:${deliveryId}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({ data: { key, scope: SCOPE } });
        return this.apply(tx, event);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replay = await this.prisma.idempotencyRecord.findUnique({
          where: { key },
        });
        if (replay)
          return { received: true, duplicate: true, action: 'duplicate' };
      }
      throw err;
    }
  }

  private async apply(
    tx: Prisma.TransactionClient,
    event: ClerkWebhookEvent,
  ): Promise<ClerkWebhookResult> {
    const data = event.data;
    const clerkId = typeof data['id'] === 'string' ? data['id'] : null;

    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        if (!clerkId) return { received: true, action: 'ignored' };
        const profile = profileFromClerkJson(data as unknown as ClerkUserJson);
        const existing = await tx.user.findUnique({
          where: { clerkId },
          select: { id: true },
        });
        // Email is unique: a collision inside an interactive transaction
        // would abort it, so check the holder first instead of catching.
        const holder = profile.email
          ? await tx.user.findUnique({
              where: { email: profile.email },
              select: { id: true },
            })
          : null;
        const emailFree =
          !!profile.email && (!holder || holder.id === existing?.id);
        if (profile.email && !emailFree) {
          this.logger.warn(
            `Clerk ${event.type} for ${clerkId}: email belongs to another account; not synced`,
          );
        }
        if (!existing) {
          if (event.type === 'user.updated' || !emailFree) {
            // Not provisioned yet — the auth middleware creates it on first API call.
            return { received: true, action: 'ignored' };
          }
          await tx.user.create({
            data: {
              clerkId,
              email: profile.email as string,
              displayName: profile.displayName,
            },
          });
          return { received: true, action: 'user_created' };
        }
        await tx.user.update({
          where: { id: existing.id },
          data: {
            displayName: profile.displayName,
            ...(emailFree ? { email: profile.email as string } : {}),
          },
        });
        return {
          received: true,
          action:
            event.type === 'user.created' ? 'user_created' : 'user_updated',
        };
      }

      case 'user.deleted': {
        if (!clerkId) return { received: true, action: 'ignored' };
        const user = await tx.user.findUnique({
          where: { clerkId },
          select: { id: true, deletedAt: true },
        });
        if (!user) return { received: true, action: 'ignored' };
        if (!user.deletedAt) {
          await tx.user.update({
            where: { id: user.id },
            data: { deletedAt: new Date() },
          });
        }
        await tx.deviceToken.deleteMany({ where: { userId: user.id } });
        this.logger.log(`Soft-deleted user ${user.id} (Clerk user.deleted)`);
        return { received: true, action: 'user_deleted' };
      }

      case 'session.removed':
      case 'session.ended':
      case 'session.revoked': {
        const userId =
          typeof data['user_id'] === 'string' ? data['user_id'] : 'unknown';
        this.logger.log(
          `Clerk ${event.type} for ${userId} (stateless API: nothing to revoke)`,
        );
        return { received: true, action: 'session_logged' };
      }

      default:
        return { received: true, action: 'ignored' };
    }
  }
}
