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
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/courses.page').then((m) => m.CoursesPage),
      },
      {
        path: 'courses/:slug',
        canActivate: [sectionGuard('courses')],
        canDeactivate: [unsavedChangesGuard],
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
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/categories.page').then((m) => m.CategoriesPage),
      },
      {
        path: 'promotions',
        canActivate: [sectionGuard('promotions')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/promotions.page').then((m) => m.PromotionsPage),
      },
      {
        path: 'plans',
        canActivate: [sectionGuard('plans')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/plans.page').then((m) => m.PlansPage),
      },
      {
        path: 'items',
        canActivate: [sectionGuard('items')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/items.page').then((m) => m.ItemsPage),
      },
      {
        path: 'gamification',
        canActivate: [sectionGuard('gamification')],
        canDeactivate: [unsavedChangesGuard],
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
        path: 'exercise-health',
        canActivate: [sectionGuard('exerciseHealth')],
        loadComponent: () =>
          import('./pages/exercise-health.page').then(
            (m) => m.ExerciseHealthPage,
          ),
      },
      {
        path: 'audit',
        canActivate: [sectionGuard('audit')],
        loadComponent: () =>
          import('./pages/audit.page').then((m) => m.AuditPage),
      },
      {
        path: 'leagues',
        canActivate: [sectionGuard('leagues')],
        loadComponent: () =>
          import('./pages/leagues.page').then((m) => m.LeaguesPage),
      },
      {
        path: 'promo-codes',
        canActivate: [sectionGuard('promoCodes')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/promo-codes.page').then((m) => m.PromoCodesPage),
      },
      {
        path: 'item-categories',
        canActivate: [sectionGuard('itemCategories')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/item-categories.page').then(
            (m) => m.ItemCategoriesPage,
          ),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'settings',
        canActivate: [sectionGuard('settings')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/settings.page').then((m) => m.SettingsPage),
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
