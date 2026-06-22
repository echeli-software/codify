import { Route } from '@angular/router';
import { authGuard } from '@codify/auth';

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
    canActivate: [authGuard()],
    loadComponent: () => import('./pages/shell.page').then((m) => m.ShellPage),
    children: [
      {
        path: 'today',
        loadComponent: () =>
          import('./pages/today.page').then((m) => m.TodayPage),
      },
      {
        path: 'catalog',
        loadComponent: () =>
          import('./pages/catalog.page').then((m) => m.CatalogPage),
      },
      {
        path: 'courses/:slug',
        loadComponent: () =>
          import('./pages/course-detail.page').then((m) => m.CourseDetailPage),
      },
      {
        path: 'lessons/:id',
        loadComponent: () =>
          import('./pages/lesson.page').then((m) => m.LessonPage),
      },
      {
        path: 'avatar',
        loadComponent: () =>
          import('./pages/avatar.page').then((m) => m.AvatarPage),
      },
      {
        path: 'shop',
        loadComponent: () =>
          import('./pages/shop.page').then((m) => m.ShopPage),
      },
      {
        path: 'subscription',
        loadComponent: () =>
          import('./pages/subscription.page').then((m) => m.SubscriptionPage),
      },
      {
        path: 'downloads',
        loadComponent: () =>
          import('./pages/downloads.page').then((m) => m.DownloadsPage),
      },
      {
        path: 'billing/success',
        loadComponent: () =>
          import('./pages/billing-success.page').then((m) => m.BillingSuccessPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
        // Profile is student-facing — but Support / Admin should not be
        // funneled here from the role tabs. Leaving open to all roles for
        // now; tighten in Phase 4b when admin app gets its own profile.
      },
      { path: '', pathMatch: 'full', redirectTo: 'today' },
    ],
  },
];
