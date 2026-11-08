import type { CanDeactivateFn } from '@angular/router';

/** A page that may hold unsaved work (the lesson player). */
export interface ConfirmsExit {
  confirmExit(): boolean | Promise<boolean>;
}

/**
 * docs/05 Lesson player: leaving mid-lesson with unsaved answers asks for
 * confirmation. Kept import-free so it costs nothing in app.routes.
 */
export const lessonExitGuard: CanDeactivateFn<ConfirmsExit> = (component) =>
  component?.confirmExit ? component.confirmExit() : true;
