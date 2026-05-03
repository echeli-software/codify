import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
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
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'today' },
    ],
  },
];
