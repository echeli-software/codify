import { type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG, type AuthConfig, isTokenAllowed } from './config.js';

function statusOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'status' in err
    ? (err as { status: number }).status
    : undefined;
}

/** Sign out and send the user to the login page, remembering where they were. */
function handleUnauthorized(
  auth: AuthService,
  router: Router | null,
  config: AuthConfig,
): void {
  void auth.signOut();
  if (!router) return;
  const loginPath = config.loginPath ?? '/login';
  const current = router.url;
  if (current === loginPath || current.startsWith(`${loginPath}?`)) return;
  void router.navigate([loginPath], { queryParams: { redirect: current } });
}

/**
 * Functional HTTP interceptor:
 *  - attaches `Authorization: Bearer <token>` ONLY to requests under the
 *    configured API base URL / allowlist (never to third parties);
 *  - obtains the token asynchronously per request (`AuthService.getToken()`
 *    — Clerk refreshes it transparently);
 *  - on a 401 for an authenticated request, signs out and navigates to
 *    `/login?redirect=<current url>`.
 */
export const authInterceptorFn: HttpInterceptorFn = (req, next) => {
  const config = inject(AUTH_CONFIG);
  if (!isTokenAllowed(req.url, config)) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router, { optional: true });

  return from(auth.getToken()).pipe(
    switchMap((token) => {
      const authReq = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req;
      return next(authReq).pipe(
        tap({
          error: (err: unknown) => {
            if (token && statusOf(err) === 401)
              handleUnauthorized(auth, router, config);
          },
        }),
      );
    }),
  );
};

/**
 * For `provideHttpClient(withInterceptors([authInterceptor(), …]))`.
 */
export function authInterceptor(): HttpInterceptorFn {
  return authInterceptorFn;
}
