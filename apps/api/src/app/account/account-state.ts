/**
 * Account lifecycle rules (docs/14 §12–13), shared by the auth middleware,
 * the /me account endpoints and the purge job. Pure — no I/O.
 *
 *  - Self-service deletion sets `deletionRequestedAt` + `deletedAt`. The
 *    user can restore for RESTORE_WINDOW_DAYS; the row is anonymised
 *    PURGE_AFTER_DAYS after `deletedAt` (`purgedAt`).
 *  - `deletedAt` without `deletionRequestedAt` = deleted by the auth
 *    provider (Clerk `user.deleted`): never restorable here.
 *  - `suspendedAt` = admin/support suspension.
 */

export const RESTORE_WINDOW_DAYS = 14;
export const PURGE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountLifecycle {
  deletedAt: Date | null;
  deletionRequestedAt: Date | null;
  purgedAt: Date | null;
  suspendedAt: Date | null;
}

export type AccountStatus = 'active' | 'deleted' | 'suspended';

/** Until when a soft-deleted account can be restored (null: not restorable). */
export function restorableUntil(
  a: Pick<AccountLifecycle, 'deletedAt' | 'deletionRequestedAt' | 'purgedAt'>,
  now: Date = new Date(),
): Date | null {
  if (!a.deletedAt || !a.deletionRequestedAt || a.purgedAt) return null;
  const until = new Date(a.deletedAt.getTime() + RESTORE_WINDOW_DAYS * DAY_MS);
  return until > now ? until : null;
}

/** When the purge job anonymises a soft-deleted account. */
export function purgeAt(a: Pick<AccountLifecycle, 'deletedAt'>): Date | null {
  return a.deletedAt
    ? new Date(a.deletedAt.getTime() + PURGE_AFTER_DAYS * DAY_MS)
    : null;
}

/** Suspension wins over deletion (a suspended user cannot restore). */
export function accountStatus(a: AccountLifecycle): AccountStatus {
  if (a.suspendedAt) return 'suspended';
  if (a.deletedAt) return 'deleted';
  return 'active';
}

export interface AccountBlock {
  code: 'ACCOUNT_DELETED' | 'ACCOUNT_SUSPENDED';
  message: string;
  restorableUntil?: string | null;
}

/**
 * Routes a blocked account may still call (path after the global prefix).
 * Deleted: read status + restore. Suspended: read status only.
 */
const STATUS_ROUTE = /^(?:\/[^/]+)?\/me\/account-status\/?$/;
const RESTORE_ROUTE = /^(?:\/[^/]+)?\/me\/restore\/?$/;

/**
 * The 403 body for a request from a deleted/suspended account, or null when
 * the request may proceed. `path` is the URL path without the query string.
 */
export function accountBlockFor(
  a: AccountLifecycle,
  method: string,
  path: string,
  now: Date = new Date(),
): AccountBlock | null {
  const status = accountStatus(a);
  if (status === 'active') return null;
  const m = method.toUpperCase();
  if (m === 'GET' && STATUS_ROUTE.test(path)) return null;
  if (status === 'suspended') {
    return {
      code: 'ACCOUNT_SUSPENDED',
      message: 'This account has been suspended',
    };
  }
  if (m === 'POST' && RESTORE_ROUTE.test(path)) return null;
  const until = restorableUntil(a, now);
  return {
    code: 'ACCOUNT_DELETED',
    message: until
      ? 'This account is scheduled for deletion and can still be restored'
      : 'This account has been deleted',
    restorableUntil: until ? until.toISOString() : null,
  };
}
