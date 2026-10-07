import { Route } from '@angular/router';
import { authGuard } from '@codify/auth';
import {
  growthLinkGuard,
  rootRedirectGuard,
} from './pages/shared/route-guards.js';

export const appRoutes: Route[] = [
  // `/` — Today when signed in, the public landing otherwise.
  {
    path: '',
    pathMatch: 'full',
    canActivate: [rootRedirectGuard],
    children: [],
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage),
  },
  // Public marketing + certificate verification — outside the auth shell.
  {
    path: 'welcome',
    loadComponent: () =>
      import('./pages/marketing.page').then((m) => m.MarketingPage),
  },
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pages/pricing.page').then((m) => m.PricingPage),
  },
  {
    path: 'features',
    loadComponent: () =>
      import('./pages/features.page').then((m) => m.FeaturesPage),
  },
  {
    path: 'verify',
    loadComponent: () =>
      import('./pages/certificate-verify.page').then(
        (m) => m.CertificateVerifyPage,
      ),
  },
  {
    path: 'verify/:serial',
    loadComponent: () =>
      import('./pages/certificate-verify.page').then(
        (m) => m.CertificateVerifyPage,
      ),
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  // Growth links (docs/18): the code is stored before the auth check so it
  // survives sign-up, then claimed once signed in.
  {
    path: 'r/:code',
    canActivate: [growthLinkGuard(['referral', 'invite'])],
    data: { kind: 'referral' },
    loadComponent: () =>
      import('./pages/growth-link.page').then((m) => m.GrowthLinkPage),
  },
  {
    path: 'invite/:code',
    canActivate: [growthLinkGuard(['invite'])],
    data: { kind: 'invite' },
    loadComponent: () =>
      import('./pages/growth-link.page').then((m) => m.GrowthLinkPage),
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
        path: 'my-courses',
        loadComponent: () =>
          import('./pages/my-courses.page').then((m) => m.MyCoursesPage),
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
        path: 'league',
        loadComponent: () =>
          import('./pages/league.page').then((m) => m.LeaguePage),
      },
      {
        path: 'friends',
        loadComponent: () =>
          import('./pages/friends.page').then((m) => m.FriendsPage),
      },
      {
        path: 'u/:id',
        loadComponent: () =>
          import('./pages/user-profile.page').then((m) => m.UserProfilePage),
      },
      {
        path: 'billing/success',
        loadComponent: () =>
          import('./pages/billing-success.page').then(
            (m) => m.BillingSuccessPage,
          ),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'today' },
    ],
  },
  { path: '**', redirectTo: '' },
];
