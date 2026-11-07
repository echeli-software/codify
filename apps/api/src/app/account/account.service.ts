import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { ClerkService, type ClerkBanResult } from '../auth/clerk.service.js';
import { BillingService } from '../billing/billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  accountStatus,
  purgeAt,
  restorableUntil,
  type AccountLifecycle,
  type AccountStatus,
} from './account-state.js';

const LIFECYCLE_SELECT = {
  id: true,
  role: true,
  deletedAt: true,
  deletionRequestedAt: true,
  purgedAt: true,
  suspendedAt: true,
  suspendedReason: true,
} as const;

type LifecycleRow = AccountLifecycle & {
  id: string;
  role: ApiUser['role'];
  suspendedReason: string | null;
};

/** GET /me/account-status. */
export interface AccountStatusView {
  status: AccountStatus;
  deletedAt: string | null;
  deletionRequestedAt: string | null;
  /** Open restore window end; null when not restorable. */
  restorableUntil: string | null;
  /** When the account is anonymised (soft-deleted accounts only). */
  purgeAt: string | null;
  suspendedAt: string | null;
}

/** Staff view adds the suspension reason. */
export interface AdminAccountStatusView extends AccountStatusView {
  userId: string;
  role: ApiUser['role'];
  suspendedReason: string | null;
  purgedAt: string | null;
}

export interface DeleteAccountResult extends AccountStatusView {
  /** Web subscriptions whose auto-renewal was stopped (access runs to period end). */
  autoRenewStopped: Array<{ id: string; planName: string }>;
  /**
   * App Store / Google Play subscriptions: they keep renewing until the user
   * cancels them in the store — we cannot do it for them.
   */
  storeSubscriptions: Array<{ id: string; planName: string; source: string }>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Account lifecycle: self-service delete + restore (docs/14 §13), and
 * staff suspension (docs/04 Users). Lifecycle rules live in
 * account-state.ts; the auth middleware enforces them on every request.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly clerk: ClerkService,
  ) {}

  async status(userId: string, now = new Date()): Promise<AccountStatusView> {
    return toStatus(await this.load(userId), now);
  }

  async adminStatus(
    userId: string,
    now = new Date(),
  ): Promise<AdminAccountStatusView> {
    const row = await this.load(userId);
    return {
      ...toStatus(row, now),
      userId: row.id,
      role: row.role,
      suspendedReason: row.suspendedReason,
      purgedAt: iso(row.purgedAt),
    };
  }

  /**
   * Soft-delete the caller's account. Auto-renewals are stopped first (a
   * provider failure aborts before anything is marked, so a retry is safe),
   * then the account is marked deleted and its push targets removed.
   */
  async requestDeletion(
    actor: ApiUser,
    now = new Date(),
  ): Promise<DeleteAccountResult> {
    if (actor.role === 'ADMIN') {
      throw new ForbiddenException({
        code: 'ADMIN_SELF_DELETE',
        message:
          'Admin accounts cannot delete themselves — ask another admin to change your role first',
      });
    }
    const row = await this.load(actor.userId);
    if (row.deletedAt) {
      throw new ConflictException({
        code: 'ALREADY_DELETED',
        message: 'This account is already scheduled for deletion',
      });
    }
    const { stopped, store } = await this.billing.stopAutoRenewForUser(
      actor.userId,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.deviceToken.deleteMany({ where: { userId: actor.userId } });
      return tx.user.update({
        where: { id: actor.userId },
        data: { deletedAt: now, deletionRequestedAt: now },
        select: LIFECYCLE_SELECT,
      });
    });
    this.logger.log(
      `User ${actor.userId} requested deletion (auto-renew stopped: ${stopped.length}, store subscriptions: ${store.length})`,
    );
    return {
      ...toStatus(updated, now),
      autoRenewStopped: stopped,
      storeSubscriptions: store,
    };
  }

  /** Undo a self-service deletion inside the restore window. */
  async restore(userId: string, now = new Date()): Promise<AccountStatusView> {
    const row = await this.load(userId);
    if (!row.deletedAt) {
      throw new ConflictException({
        code: 'NOT_DELETED',
        message: 'This account is not scheduled for deletion',
      });
    }
    if (!restorableUntil(row, now)) {
      throw new ConflictException({
        code: 'RESTORE_WINDOW_PASSED',
        message: 'This account can no longer be restored',
      });
    }
    // Guarded update: a concurrent purge/restore cannot be overwritten.
    const res = await this.prisma.user.updateMany({
      where: { id: userId, deletedAt: row.deletedAt, purgedAt: null },
      data: { deletedAt: null, deletionRequestedAt: null },
    });
    if (res.count === 0) {
      throw new ConflictException({
        code: 'RESTORE_WINDOW_PASSED',
        message: 'This account can no longer be restored',
      });
    }
    return this.status(userId, now);
  }

  /**
   * Staff suspension. SUPPORT may suspend students and teachers; ADMIN may
   * suspend anyone but themselves. Re-suspending only updates the reason.
   */
  async suspend(
    actor: ApiUser,
    userId: string,
    reason: string,
    now = new Date(),
  ): Promise<{
    before: AdminAccountStatusView;
    after: AdminAccountStatusView;
    identityProvider: ClerkBanResult;
  }> {
    const before = await this.adminStatus(userId, now);
    this.assertMayModerate(actor, before);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        suspendedAt: before.suspendedAt ? new Date(before.suspendedAt) : now,
        suspendedReason: reason,
      },
    });
    // Suspended accounts get no pushes.
    await this.prisma.deviceToken.deleteMany({ where: { userId } });
    const after = await this.adminStatus(userId, now);
    return {
      before,
      after,
      identityProvider: await this.syncClerkBan(userId, true),
    };
  }

  async unsuspend(
    actor: ApiUser,
    userId: string,
    now = new Date(),
  ): Promise<{
    before: AdminAccountStatusView;
    after: AdminAccountStatusView;
    identityProvider: ClerkBanResult;
  }> {
    const before = await this.adminStatus(userId, now);
    this.assertMayModerate(actor, before);
    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspendedReason: null },
    });
    const after = await this.adminStatus(userId, now);
    return {
      before,
      after,
      identityProvider: await this.syncClerkBan(userId, false),
    };
  }

  /**
   * Mirror the local suspension at the identity provider (Clerk ban /
   * unban). Runs after the local change is committed and never throws: a
   * Clerk outage must not undo a suspension (the auth middleware enforces
   * `suspendedAt` on every request regardless).
   */
  private async syncClerkBan(
    userId: string,
    banned: boolean,
  ): Promise<ClerkBanResult> {
    try {
      const row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { clerkId: true },
      });
      return await this.clerk.setBanned(row?.clerkId, banned);
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }
  }

  private assertMayModerate(
    actor: ApiUser,
    target: AdminAccountStatusView,
  ): void {
    if (actor.userId === target.userId) {
      throw new BadRequestException({
        code: 'CANNOT_SUSPEND_SELF',
        message: 'You cannot suspend or unsuspend your own account',
      });
    }
    if (
      actor.role === 'SUPPORT' &&
      target.role !== 'STUDENT' &&
      target.role !== 'TEACHER'
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Only an admin can suspend staff accounts',
        requiredRole: 'ADMIN',
      });
    }
    if (target.purgedAt) {
      throw new ConflictException({
        code: 'ACCOUNT_PURGED',
        message: 'This account has been anonymised',
      });
    }
  }

  private async load(userId: string): Promise<LifecycleRow> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: LIFECYCLE_SELECT,
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }
}

function toStatus(row: LifecycleRow, now: Date): AccountStatusView {
  return {
    status: accountStatus(row),
    deletedAt: iso(row.deletedAt),
    deletionRequestedAt: iso(row.deletionRequestedAt),
    restorableUntil: iso(restorableUntil(row, now)),
    purgeAt: row.deletedAt && !row.purgedAt ? iso(purgeAt(row)) : null,
    suspendedAt: iso(row.suspendedAt),
  };
}
