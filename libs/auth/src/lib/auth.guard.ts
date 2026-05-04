import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthService } from './auth.service.js';
import type { UserRole } from './types.js';

/**
 * Route guard factory. Pass a list of allowed roles; an empty list (default)
 * means "any authenticated user qualifies".
 *
 *   { path: 'admin', canActivate: [authGuard(['ADMIN', 'SUPPORT'])], ... }
 *
 * Behavior:
 * - Unauthenticated → redirect to `/login` (configurable via `loginPath`).
 * - Authenticated but wrong role → redirect to `/forbidden`.
 * - Authenticated and authorized → returns true synchronously.
 *
 * Bypasses redirects when the user state is still loading; the auth service
 * resolves loading on construction so this rarely matters in practice.
 */
export function authGuard(
  roles: readonly UserRole[] = [],
  options: { loginPath?: string; forbiddenPath?: string } = {},
): CanActivateFn {
  return (): boolean | UrlTree => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const loginPath = options.loginPath ?? '/login';
    const forbiddenPath = options.forbiddenPath ?? '/forbidden';

    if (!auth.isAuthenticated()) {
      return router.parseUrl(loginPath);
    }
    if (!auth.hasAnyRole(roles)) {
      return router.parseUrl(forbiddenPath);
    }
    return true;
  };
}
