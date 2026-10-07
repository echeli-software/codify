import { DestroyRef, inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { I18nService } from '@codify/i18n';
import { ConfirmDialogService } from '@codify/ui-bootstrap';

/** Implemented by editor pages that can hold unsaved work. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * `canDeactivate` guard: when the page reports unsaved changes, ask before
 * leaving (docs/04 §5 "Unsaved-changes guard on route navigation").
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (
  component,
) => {
  if (!component || !component.hasUnsavedChanges()) return true;
  const i18n = inject(I18nService);
  const confirm = inject(ConfirmDialogService);
  return confirm
    .open({
      title: i18n.t('admin.unsaved.title'),
      message: i18n.t('admin.unsaved.message'),
      confirmLabel: i18n.t('admin.unsaved.leave'),
      cancelLabel: i18n.t('admin.unsaved.stay'),
      confirmKind: 'danger',
      icon: 'warning',
    })
    .then((ok) => ok === true);
};

/**
 * Browser-level counterpart: warn on tab close / reload while `isDirty()`.
 * Call from a component constructor (injection context).
 */
export function warnOnUnload(isDirty: () => boolean): void {
  if (typeof window === 'undefined') return;
  const handler = (ev: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    ev.preventDefault();
    // Legacy browsers need returnValue set to show the prompt.
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  inject(DestroyRef).onDestroy(() =>
    window.removeEventListener('beforeunload', handler),
  );
}
