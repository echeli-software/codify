import { DestroyRef, ElementRef, inject, type Signal } from '@angular/core';

type OverlayElement = HTMLElement & {
  dismiss?: (data?: unknown, role?: string) => Promise<boolean>;
};

/**
 * Ionic re-parents a presented inline `<ion-modal>` into the overlay
 * container, so destroying the owning view (route change, story switch)
 * can leave the open overlay — and its focus trap / `banner` header —
 * behind. Call from a constructor with the modal's `viewChild` to dismiss
 * and detach it when the component is destroyed.
 */
export function teardownOverlayOnDestroy(
  overlay: Signal<ElementRef<HTMLElement> | undefined>,
): void {
  inject(DestroyRef).onDestroy(() => {
    let el: OverlayElement | undefined;
    try {
      el = overlay()?.nativeElement as OverlayElement | undefined;
    } catch {
      return;
    }
    if (!el) return;
    el.dismiss?.(undefined, 'destroy')?.catch(() => undefined);
    el.remove();
  });
}
