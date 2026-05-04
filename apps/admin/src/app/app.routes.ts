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
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  {
    path: '',
    canActivate: [authGuard(STAFF_ROLES)],
    loadComponent: () => import('./pages/shell.page').then((m) => m.ShellPage),
    children: [
      {
        path: 'playground',
        loadComponent: () =>
          import('./pages/playground.page').then((m) => m.PlaygroundPage),
      },
      {
        path: 'courses',
        loadComponent: () =>
          import('./pages/courses.page').then((m) => m.CoursesPage),
      },
      {
        path: 'lessons',
        loadComponent: () =>
          import('./pages/lessons.page').then((m) => m.LessonsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'playground' },
    ],
  },
];
