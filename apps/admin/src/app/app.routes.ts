import { Route } from '@angular/router';
import { authGuard } from '@codify/auth';

// Admin app is staff-only — STUDENT role hits /forbidden.
const STAFF_ROLES = ['ADMIN', 'TEACHER', 'SUPPORT'] as const;

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage),
  },
  {
    // Staff session refused for MFA / 12 h age (core/staff-session.ts).
    path: 'reauth',
    loadComponent: () =>
      import('./pages/reauth.page').then((m) => m.ReauthPage),
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  {
    path: '',
    canActivate: [authGuard(STAFF_ROLES)],
    loadChildren: () => import('./shell.routes').then((m) => m.SHELL_ROUTES),
  },
];
