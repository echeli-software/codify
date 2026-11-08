import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { reportException } from '../common/sentry.js';
import { jobsEnabled } from '../gamification/jobs.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PURGE_AFTER_DAYS } from './account-state.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Daily, 03:17 UTC (off the hour so it doesn't pile onto other jobs). */
export const ACCOUNT_PURGE_CRON = '17 3 * * *';
const BATCH = 100;

export const PURGED_DISPLAY_NAME = 'Deleted user';
export const purgedEmail = (userId: string) =>
  `deleted+${userId}@users.invalid`;

export interface PurgeSummary {
  purged: number;
  failed: number;
}

/**
 * Hard-delete stage of account deletion (docs/14 §12 Retention): accounts
 * soft-deleted more than PURGE_AFTER_DAYS ago are anonymised in place.
 *
 * - The User row stays (the gamification ledger, payments, subscriptions,
 *   enrollments and progress reference it and are "retained anonymized for
 *   accounting"), but every PII field is overwritten: email →
 *   `deleted+<id>@users.invalid`, display name, avatar, referral code,
 *   quiet hours, notification settings; `clerkId` → `purged:<id>` so the
 *   auth identity no longer maps to it (a new sign-up gets a new account).
 * - Personal rows that are not accounting records are deleted: device
 *   tokens, notifications + preferences, friendships / requests / nudges,
 *   analytics events, certificates (they carry the recipient's name),
 *   guardian confirmations (a parent's name + email). The date of birth
 *   is cleared.
 * - User-authored content is blanked but the graded rows kept for course
 *   statistics: exercise code / output / per-test results, AI-prompt
 *   answers + rubric breakdowns.
 *
 * Idempotent: each user is purged in one transaction that sets `purgedAt`,
 * and only rows with `purgedAt IS NULL` are picked up.
 */
@Injectable()
export class AccountPurgeService {
  private readonly logger = new Logger(AccountPurgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(ACCOUNT_PURGE_CRON, { name: 'account-purge', timeZone: 'UTC' })
  async scheduled(): Promise<void> {
    if (!jobsEnabled()) return;
    try {
      const res = await this.purgeDue();
      if (res.purged || res.failed)
        this.logger.log(
          `Account purge: ${res.purged} anonymised, ${res.failed} failed`,
        );
    } catch (err) {
      this.logger.error(`Account purge failed: ${(err as Error).message}`);
      reportException(err, { tags: { job: 'account-purge' } });
    }
  }

  /** Purge every account past the retention window. */
  async purgeDue(now = new Date()): Promise<PurgeSummary> {
    const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS);
    const summary: PurgeSummary = { purged: 0, failed: 0 };
    const failed = new Set<string>();
    for (;;) {
      const due = await this.prisma.user.findMany({
        where: {
          deletedAt: { lt: cutoff },
          purgedAt: null,
          ...(failed.size ? { id: { notIn: [...failed] } } : {}),
        },
        select: { id: true },
        orderBy: { deletedAt: 'asc' },
        take: BATCH,
      });
      if (due.length === 0) break;
      for (const { id } of due) {
        try {
          if (await this.purgeUser(id, now)) summary.purged += 1;
        } catch (err) {
          failed.add(id);
          summary.failed += 1;
          this.logger.error(
            `Purge of user ${id} failed: ${(err as Error).message}`,
          );
          reportException(err, { tags: { job: 'account-purge' } });
        }
      }
    }
    return summary;
  }

  /** Anonymise one user. False when there was nothing to do (already purged / not deleted). */
  async purgeUser(userId: string, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Claim first: the guarded update makes concurrent runs no-ops.
      const claimed = await tx.user.updateMany({
        where: { id: userId, purgedAt: null, deletedAt: { not: null } },
        data: {
          purgedAt: now,
          email: purgedEmail(userId),
          clerkId: `purged:${userId}`,
          displayName: PURGED_DISPLAY_NAME,
          avatarConfig: Prisma.DbNull,
          referralCode: null,
          quietHoursStart: null,
          quietHoursEnd: null,
          marketingEmailOptIn: false,
          pushDailyCap: null,
          pushWeeklyOptIn: false,
          reminderMinute: null,
          suspendedReason: null,
          // docs/14 "Minors": no date of birth survives the purge.
          birthDate: null,
        },
      });
      if (claimed.count === 0) return false;

      const mine = { userId };
      await tx.deviceToken.deleteMany({ where: mine });
      await tx.notification.deleteMany({ where: mine });
      await tx.notificationPreference.deleteMany({ where: mine });
      await tx.friendNudge.deleteMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      });
      await tx.friendRequest.deleteMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      });
      await tx.friendship.deleteMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      });
      await tx.analyticsEvent.deleteMany({ where: mine });
      await tx.certificate.deleteMany({ where: mine });
      // Guardian confirmations carry a third party's name + email.
      await tx.guardianConsent.deleteMany({ where: mine });
      await tx.submission.updateMany({
        where: mine,
        data: { code: '', output: null, resultJson: Prisma.DbNull },
      });
      await tx.aiSubmission.updateMany({
        where: mine,
        data: { response: '', breakdownJson: [] },
      });
      // The user's own audit rows keep the action trail but lose the
      // network identifiers (docs/14 §11–12); rows by staff about this
      // user carry the staff member's IP and are kept.
      await tx.auditLog.updateMany({
        where: { actorId: userId },
        data: { ip: null, userAgent: null },
      });
      await tx.auditLog.create({
        data: {
          action: 'user.purged',
          entity: 'User',
          entityId: userId,
          diff: { purgedAt: now.toISOString() },
        },
      });
      return true;
    });
  }
}
