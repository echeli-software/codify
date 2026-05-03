import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'playground',
    loadComponent: () => import('./pages/playground.page').then((m) => m.PlaygroundPage),
  },
  {
    path: 'courses',
    loadComponent: () => import('./pages/courses.page').then((m) => m.CoursesPage),
  },
  {
    path: 'lessons',
    loadComponent: () => import('./pages/lessons.page').then((m) => m.LessonsPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'playground' },
];
