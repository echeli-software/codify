import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { ApiUserRole } from './types.js';

/** Account lifecycle state (docs/14 §13). */
export type AccountStatus = 'active' | 'deleted' | 'suspended';

/** GET /me/account-status — readable even while deleted or suspended. */
export interface AccountStatusView {
  status: AccountStatus;
  deletedAt: string | null;
  deletionRequestedAt: string | null;
  /** End of the 14-day restore window; null when not restorable. */
  restorableUntil: string | null;
  /** When a soft-deleted account is anonymised (30 days after deletion). */
  purgeAt: string | null;
  suspendedAt: string | null;
}

/** Staff view (GET /admin/users/:id/account-status, suspend, unsuspend). */
export interface AdminAccountStatusView extends AccountStatusView {
  userId: string;
  role: ApiUserRole;
  suspendedReason: string | null;
  purgedAt: string | null;
}

/**
 * Suspend / unsuspend response. `warning` is set when the local change
 * succeeded but mirroring it at the identity provider (Clerk ban / unban)
 * failed — the suspension still holds (the API enforces it).
 */
export type ModerationResult = AdminAccountStatusView & {
  warning?: { code: 'IDP_SYNC_FAILED'; message: string };
};

/** POST /me/delete response. */
export interface DeleteAccountResult extends AccountStatusView {
  /** Web subscriptions set to end at period end (no further charges). */
  autoRenewStopped: Array<{ id: string; planName: string }>;
  /** App Store / Google Play subscriptions the user must cancel in the store. */
  storeSubscriptions: Array<{
    id: string;
    planName: string;
    source: 'APPLE_IAP' | 'GOOGLE_PLAY' | string;
  }>;
}

/**
 * GET /me/export body: profile, learning history, ledger, purchases,
 * notifications, analytics… (`formatVersion` 1). Opaque to the apps — it
 * is offered to the user as a JSON download.
 */
export type AccountExport = Record<string, unknown> & {
  formatVersion: number;
  exportedAt: string;
  userId: string;
};

/** Problem codes the API answers for a deleted / suspended account (403). */
export const ACCOUNT_DELETED = 'ACCOUNT_DELETED';
export const ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';
/** 429 from GET /me/export (once per 10 minutes); `data.retryAfter` seconds. */
export const EXPORT_RATE_LIMITED = 'EXPORT_RATE_LIMITED';

/**
 * Privacy + account lifecycle (Settings → Data & privacy; admin user
 * moderation). See docs/14 §13 and docs/04 Users.
 */
@Injectable({ providedIn: 'root' })
export class AccountClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** GET /me/account-status */
  status(): Promise<AccountStatusView> {
    return firstValueFrom(
      this.http.get<AccountStatusView>(
        `${this.config.baseUrl}/me/account-status`,
      ),
    );
  }

  /** GET /me/export — the full data export (throttled: 429 EXPORT_RATE_LIMITED). */
  exportData(): Promise<AccountExport> {
    return firstValueFrom(
      this.http.get<AccountExport>(`${this.config.baseUrl}/me/export`),
    );
  }

  /** POST /me/delete — soft delete with a 14-day restore window. */
  deleteAccount(): Promise<DeleteAccountResult> {
    return firstValueFrom(
      this.http.post<DeleteAccountResult>(`${this.config.baseUrl}/me/delete`, {
        confirm: 'DELETE',
      }),
    );
  }

  /** POST /me/restore — undo a deletion inside the window. */
  restore(): Promise<AccountStatusView> {
    return firstValueFrom(
      this.http.post<AccountStatusView>(
        `${this.config.baseUrl}/me/restore`,
        {},
      ),
    );
  }

  /** ADMIN/SUPPORT: a user's lifecycle state incl. the suspension reason. */
  adminStatus(userId: string): Promise<AdminAccountStatusView> {
    return firstValueFrom(
      this.http.get<AdminAccountStatusView>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(userId)}/account-status`,
      ),
    );
  }

  /** ADMIN/SUPPORT (SUPPORT: student/teacher accounts only). Audited. */
  suspend(userId: string, reason: string): Promise<ModerationResult> {
    return firstValueFrom(
      this.http.post<ModerationResult>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(userId)}/suspend`,
        { reason },
      ),
    );
  }

  /** ADMIN/SUPPORT. Audited. */
  unsuspend(userId: string): Promise<ModerationResult> {
    return firstValueFrom(
      this.http.post<ModerationResult>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(userId)}/unsuspend`,
        {},
      ),
    );
  }
}
