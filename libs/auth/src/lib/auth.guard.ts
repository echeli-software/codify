import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG } from './config.js';
import type { UserRole } from './types.js';

/**
 * Route guard factory. Pass a list of allowed roles; an empty list (default)
 * means "any authenticated user qualifies".
 *
 *   { path: 'admin', canActivate: [authGuard(['ADMIN', 'SUPPORT'])], ... }
 *
 * - Waits for the initial auth state (Clerk load + `/me`) before deciding.
 * - Unauthenticated → `/login?redirect=<attempted url>`.
 * - Authenticated but wrong role → `/forbidden`.
 */
export function authGuard(
  roles: readonly UserRole[] = [],
  options: { loginPath?: string; forbiddenPath?: string } = {},
): CanActivateFn {
  return async (_route, state): Promise<boolean | UrlTree> => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const config = inject(AUTH_CONFIG);
    const loginPath = options.loginPath ?? config.loginPath ?? '/login';
    const forbiddenPath =
      options.forbiddenPath ?? config.forbiddenPath ?? '/forbidden';

    await auth.whenReady();
    if (!auth.isAuthenticated()) {
      return router.createUrlTree([loginPath], {
        queryParams: { redirect: state.url },
      });
    }
    if (!auth.hasAnyRole(roles)) {
      return router.parseUrl(forbiddenPath);
    }
    return true;
  };
}
