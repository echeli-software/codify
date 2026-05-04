import { inject } from '@angular/core';
import { HTTP_INTERCEPTORS, type HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from './auth.service.js';
import { tap } from 'rxjs/operators';
import type { Provider } from '@angular/core';

/**
 * Functional HTTP interceptor: attaches the AuthService bearer token to
 * outgoing requests, and clears the session on 401.
 *
 * Skips the Authorization header when the token is missing — public
 * endpoints (e.g. `/health`) keep working pre-login.
 */
export const authInterceptorFn: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.currentToken();
  const authReq = token
    ? req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      })
    : req;

  return next(authReq).pipe(
    tap({
      error: (err: unknown) => {
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 401
        ) {
          auth.signOut();
        }
      },
    }),
  );
};

/**
 * Provider for `provideHttpClient(withInterceptors([...]))`. Use this
 * inline in app config:
 *
 *   provideHttpClient(withInterceptors([authInterceptor()]))
 */
export function authInterceptor(): HttpInterceptorFn {
  return authInterceptorFn;
}

/**
 * Legacy class-style provider escape hatch in case the host wires a
 * non-standalone bootstrap. Most callers should use `authInterceptor()`.
 */
export const AUTH_INTERCEPTOR_PROVIDER: Provider = {
  provide: HTTP_INTERCEPTORS,
  useValue: authInterceptorFn,
  multi: true,
};
