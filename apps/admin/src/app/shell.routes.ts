import { Route } from '@angular/router';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  ASSET_LIBRARY,
  FILE_UPLOADER,
  LESSON_ASSET_UPLOADER,
} from '@codify/ui-bootstrap';
import { sectionGuard } from './core/roles';
import { unsavedChangesGuard } from './core/unsaved-changes';
import {
  AssetsAssetLibrary,
  AssetsFileUploader,
  AssetsLessonUploader,
} from './core/uploads';
import { ShellPage } from './pages/shell.page';

/**
 * Everything behind sign-in. Loaded lazily so @codify/ui-bootstrap (which
 * isn't side-effect free) stays out of the initial bundle.
 *
 * The media upload adapters are provided here: presign → PUT with progress
 * → confirm through AssetsClient. NgbModal is re-provided so dialogs opened
 * from these routes (the asset picker) resolve ASSET_LIBRARY from this
 * injector.
 */
export const SHELL_ROUTES: Route[] = [
  {
    path: '',
    component: ShellPage,
    providers: [
      NgbModal,
      { provide: LESSON_ASSET_UPLOADER, useExisting: AssetsLessonUploader },
      { provide: FILE_UPLOADER, useExisting: AssetsFileUploader },
      { provide: ASSET_LIBRARY, useExisting: AssetsAssetLibrary },
    ],
    children: [
      {
        path: 'dashboard',
        canActivate: [sectionGuard('dashboard')],
        loadComponent: () =>
          import('./pages/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'denied',
        loadComponent: () =>
          import('./pages/denied.page').then((m) => m.DeniedPage),
      },
      {
        path: 'courses',
        canActivate: [sectionGuard('courses')],
        loadComponent: () =>
          import('./pages/courses.page').then((m) => m.CoursesPage),
      },
      {
        path: 'courses/:slug',
        canActivate: [sectionGuard('courses')],
        loadComponent: () =>
          import('./pages/course-detail.page').then((m) => m.CourseDetailPage),
      },
      {
        path: 'lessons/:id',
        canActivate: [sectionGuard('courseEditing')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/lessons.page').then((m) => m.LessonsPage),
      },
      {
        path: 'lessons/:lessonId/exercise',
        canActivate: [sectionGuard('courseEditing')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/exercise-editor.page').then(
            (m) => m.ExerciseEditorPage,
          ),
      },
      {
        path: 'lessons/:lessonId/ai-prompt',
        canActivate: [sectionGuard('courseEditing')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/ai-prompt-editor.page').then(
            (m) => m.AiPromptEditorPage,
          ),
      },
      {
        path: 'lessons/:lessonId/scenario',
        canActivate: [sectionGuard('courseEditing')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/scenario-editor.page').then(
            (m) => m.ScenarioEditorPage,
          ),
      },
      {
        path: 'categories',
        canActivate: [sectionGuard('categories')],
        loadComponent: () =>
          import('./pages/categories.page').then((m) => m.CategoriesPage),
      },
      {
        path: 'promotions',
        canActivate: [sectionGuard('promotions')],
        loadComponent: () =>
          import('./pages/promotions.page').then((m) => m.PromotionsPage),
      },
      {
        path: 'plans',
        canActivate: [sectionGuard('plans')],
        loadComponent: () =>
          import('./pages/plans.page').then((m) => m.PlansPage),
      },
      {
        path: 'items',
        canActivate: [sectionGuard('items')],
        loadComponent: () =>
          import('./pages/items.page').then((m) => m.ItemsPage),
      },
      {
        path: 'gamification',
        canActivate: [sectionGuard('gamification')],
        loadComponent: () =>
          import('./pages/gamification.page').then((m) => m.GamificationPage),
      },
      {
        path: 'users',
        canActivate: [sectionGuard('users')],
        loadComponent: () =>
          import('./pages/users.page').then((m) => m.UsersPage),
      },
      {
        path: 'users/:id',
        canActivate: [sectionGuard('users')],
        loadComponent: () =>
          import('./pages/user-detail.page').then((m) => m.UserDetailPage),
      },
      {
        path: 'translations',
        canActivate: [sectionGuard('translations')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/translations.page').then((m) => m.TranslationsPage),
      },
      {
        path: 'media',
        canActivate: [sectionGuard('media')],
        loadComponent: () =>
          import('./pages/media.page').then((m) => m.MediaPage),
      },
      {
        path: 'analytics',
        canActivate: [sectionGuard('analytics')],
        loadComponent: () =>
          import('./pages/analytics.page').then((m) => m.AnalyticsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: '**',
        loadComponent: () =>
          import('./pages/not-found.page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
