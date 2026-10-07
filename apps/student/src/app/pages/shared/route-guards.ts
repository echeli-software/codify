import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService, authGuard } from '@codify/auth';
import { NativePlatformService } from '../../native/native-platform.service.js';
import {
  GrowthLinksService,
  type GrowthLinkKind,
} from './growth-links.service.js';

/**
 * `/` — signed-in users land on Today; signed-out web visitors see the
 * public landing (`/welcome`); the native shell has no marketing site, so
 * it goes straight to sign-in.
 */
export const rootRedirectGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const native = inject(NativePlatformService);
  await auth.whenReady();
  if (auth.isAuthenticated()) return router.parseUrl('/today');
  return router.parseUrl(native.isNative ? '/login' : '/welcome');
};

/**
 * `/r/:code` and `/invite/:code`: remember the code locally *before* the
 * auth check, so it survives a sign-in / sign-up round trip, then defer to
 * the normal auth guard (which returns here via `?redirect=`).
 */
export function growthLinkGuard(
  kinds: readonly GrowthLinkKind[],
): CanActivateFn {
  const auth = authGuard();
  return (route, state) => {
    const code = route.paramMap.get('code');
    const links = inject(GrowthLinksService);
    if (code) for (const k of kinds) links.remember(k, code);
    return auth(route, state);
  };
}
