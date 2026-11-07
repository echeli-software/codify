import { Injectable, inject, signal } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import {
  ACCOUNT_DELETED,
  ACCOUNT_SUSPENDED,
  type DeleteAccountResult,
} from '@codify/api-client';

export const RESTORE_PATH = '/account/restore';
export const SUSPENDED_PATH = '/account/suspended';

/** Why the API refuses this account (docs/14 §13, docs/04 Users). */
export type AccountBlock =
  | { kind: 'deleted'; restorableUntil: string | null }
  | { kind: 'suspended' };

/**
 * Account lifecycle state seen by the student app. Set by the HTTP
 * interceptor below whenever the API answers 403 ACCOUNT_DELETED /
 * ACCOUNT_SUSPENDED (every route except the status/restore ones), and by
 * the privacy page right after a self-service deletion.
 */
@Injectable({ providedIn: 'root' })
export class AccountStateService {
  private readonly _block = signal<AccountBlock | null>(null);
  /** Store subscriptions to cancel, from the deletion response (this session only). */
  private readonly _lastDeletion = signal<DeleteAccountResult | null>(null);

  readonly block = this._block.asReadonly();
  readonly lastDeletion = this._lastDeletion.asReadonly();

  set(block: AccountBlock | null): void {
    this._block.set(block);
  }

  deleted(result: DeleteAccountResult): void {
    this._lastDeletion.set(result);
    this._block.set({
      kind: 'deleted',
      restorableUntil: result.restorableUntil,
    });
  }

  clear(): void {
    this._block.set(null);
    this._lastDeletion.set(null);
  }
}

/** The account block a failed request reports, if any. */
export function accountBlockOf(err: unknown): AccountBlock | null {
  const e = err as {
    status?: number;
    code?: string;
    data?: Record<string, unknown>;
    error?: Record<string, unknown> | null;
  };
  if (e?.status !== 403) return null;
  // ProblemDetailsError (code + data) or a raw HttpErrorResponse (error body).
  const code =
    e.code ?? (typeof e.error?.['code'] === 'string' ? e.error['code'] : null);
  if (code === ACCOUNT_SUSPENDED) return { kind: 'suspended' };
  if (code !== ACCOUNT_DELETED) return null;
  const until = e.data?.['restorableUntil'] ?? e.error?.['restorableUntil'];
  return {
    kind: 'deleted',
    restorableUntil: typeof until === 'string' ? until : null,
  };
}

/**
 * Routes the app to the restore / suspended screen when the API refuses
 * the signed-in account. The error is re-thrown unchanged, so callers'
 * own error handling (toasts, offline queue) still runs.
 */
export const accountStateInterceptor: HttpInterceptorFn = (req, next) => {
  const state = inject(AccountStateService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const block = accountBlockOf(err);
      if (block) {
        state.set(block);
        const target = block.kind === 'deleted' ? RESTORE_PATH : SUSPENDED_PATH;
        if (!router.url.startsWith(target)) void router.navigateByUrl(target);
      }
      return throwError(() => err);
    }),
  );
};
