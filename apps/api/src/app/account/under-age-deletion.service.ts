import { Injectable, Logger } from '@nestjs/common';
import { ClerkService, type ClerkBanResult } from '../auth/clerk.service.js';
import { BillingService } from '../billing/billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountPurgeService } from './account-purge.service.js';

export interface UnderAgeDeletionResult {
  /** The account was anonymised now (false: it already was). */
  purged: boolean;
  /** Outcome of deleting the sign-in identity at Clerk. */
  identityProvider: ClerkBanResult;
}

/**
 * Immediate removal of an account whose date of birth is under the minimum
 * age (12, docs/14 "Minors"): no restore window, no 30-day wait.
 *
 * 1. Auto-renewing web subscriptions are stopped (best effort: a provider
 *    failure is logged and the deletion goes ahead — the data must go).
 * 2. The row is marked deleted without `deletionRequestedAt` (never
 *    restorable), then anonymised at once by the regular purge
 *    (`AccountPurgeService.purgeUser`), which also clears the date of birth.
 *    What the purge keeps (accounting / audit) is listed there.
 * 3. The Clerk user is deleted (sessions revoked); a failure is returned,
 *    not thrown: the local account is already gone and the auth middleware
 *    no longer maps the old identity to it.
 *
 * Never log the date of birth.
 */
@Injectable()
export class UnderAgeDeletionService {
  private readonly logger = new Logger(UnderAgeDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly purge: AccountPurgeService,
    private readonly clerk: ClerkService,
  ) {}

  async deleteNow(
    userId: string,
    now = new Date(),
  ): Promise<UnderAgeDeletionResult> {
    try {
      await this.billing.stopAutoRenewForUser(userId);
    } catch (err) {
      this.logger.error(
        `Under-age deletion of ${userId}: stopping auto-renew failed: ${(err as Error).message}`,
      );
    }
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clerkId: true },
    });
    await this.prisma.user.updateMany({
      where: { id: userId, purgedAt: null },
      data: { deletedAt: now, deletionRequestedAt: null, birthDate: null },
    });
    const purged = await this.purge.purgeUser(userId, now);
    const identityProvider = await this.clerk.deleteUser(row?.clerkId);
    this.logger.log(
      `User ${userId} removed: under the minimum age (identity provider: ${identityProvider.status})`,
    );
    return { purged, identityProvider };
  }
}
