import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Problem codes the API answers (403) when a staff session lacks a second
 * factor or is older than the 12 h staff limit (docs/14 §1, §18).
 */
export const STAFF_SESSION_CODES = ['MFA_REQUIRED', 'SESSION_TOO_OLD'] as const;
export type StaffSessionCode = (typeof STAFF_SESSION_CODES)[number];

/** The staff-session code of an HTTP error, if it is one. */
export function staffSessionCode(err: unknown): StaffSessionCode | null {
  if (!(err instanceof HttpErrorResponse) || err.status !== 403) return null;
  const code = (err.error as { code?: unknown } | null)?.code;
  return (STAFF_SESSION_CODES as readonly unknown[]).includes(code)
    ? (code as StaffSessionCode)
    : null;
}

/**
 * Sends the user to the re-authentication screen when any API call is
 * refused for MFA / session age. The error still propagates so the page
 * that made the call stops its spinner.
 */
export const staffSessionInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const code = staffSessionCode(err);
      if (code && !router.url.startsWith('/reauth')) {
        const hours = (err as HttpErrorResponse).error?.maxSessionHours;
        void router.navigate(['/reauth'], {
          queryParams: {
            reason: code,
            ...(typeof hours === 'number' ? { hours } : {}),
          },
        });
      }
      return throwError(() => err);
    }),
  );
};
