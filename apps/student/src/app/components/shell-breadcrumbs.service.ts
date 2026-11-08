import { Injectable, signal } from '@angular/core';

export interface Crumb {
  /** Already-localized text (content titles) or a translation key. */
  label: string;
  /** Router URL; the last crumb (current page) has none. */
  url?: string;
  /** True when `label` is a translation key. */
  key?: boolean;
}

/**
 * Breadcrumb trail of the desktop header (docs/05 §1). Pages with content
 * titles (course, lesson) set it; others fall back to the nav label of the
 * current top-level route.
 */
@Injectable({ providedIn: 'root' })
export class ShellBreadcrumbs {
  private readonly _trail = signal<{ owner: object; crumbs: Crumb[] } | null>(
    null,
  );
  readonly trail = this._trail.asReadonly();

  set(owner: object, crumbs: Crumb[]): void {
    this._trail.set({ owner, crumbs });
  }

  /** Clear when the page that set the trail goes away. */
  clear(owner: object): void {
    if (this._trail()?.owner === owner) this._trail.set(null);
  }
}
