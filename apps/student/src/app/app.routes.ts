import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'today',
    loadComponent: () => import('./pages/today.page').then((m) => m.TodayPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'today' },
];
