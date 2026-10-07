import {
  Injectable,
  inject,
  reflectComponentType,
  type ComponentRef,
  type Type,
} from '@angular/core';
import {
  NgbModal,
  type NgbModalOptions,
  type NgbModalRef,
} from '@ng-bootstrap/ng-bootstrap';

export interface OpenModalOptions<TInputs = unknown> extends NgbModalOptions {
  /**
   * Values for the modal component. Declared inputs (including signal
   * `input()`s) are set through `ComponentRef.setInput`, so OnPush + signal
   * inputs work; anything else is assigned as a plain property.
   *
   *   modal.open(CourseEditor, { inputs: { courseId } });
   */
  inputs?: TInputs;
}

/** ng-bootstrap keeps the ComponentRef on a private field; read it safely. */
export function modalComponentRef<C>(ref: NgbModalRef): ComponentRef<C> | null {
  const content = (
    ref as unknown as { _contentRef?: { componentRef?: ComponentRef<C> } }
  )._contentRef;
  return content?.componentRef ?? null;
}

/**
 * Apply `inputs` to a freshly opened modal component. Exported for the
 * other service-driven surfaces (Drawer, ConfirmDialog).
 */
export function applyModalInputs<C extends object>(
  component: Type<C>,
  ref: NgbModalRef,
  inputs: Partial<Record<string, unknown>>,
): void {
  const componentRef = modalComponentRef<C>(ref);
  const declared = new Map<string, string>();
  for (const i of reflectComponentType(component)?.inputs ?? []) {
    declared.set(i.propName, i.templateName);
    declared.set(i.templateName, i.templateName);
  }
  for (const [key, value] of Object.entries(inputs)) {
    const templateName = declared.get(key);
    if (componentRef && templateName) {
      componentRef.setInput(templateName, value);
    } else {
      // Not a declared input — fall back to a plain property write.
      (ref.componentInstance as Record<string, unknown>)[key] = value;
    }
  }
  componentRef?.changeDetectorRef.detectChanges();
}

/**
 * General-purpose modal opener. For confirmation prompts, prefer
 * `ConfirmDialogService` — this is for arbitrary editor / detail / wizard
 * surfaces.
 *
 *   const ref = modal.open(CourseEditor, { inputs: { courseId } });
 *   const result = await ref.result;
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly modal = inject(NgbModal);

  open<C extends object>(
    component: Type<C>,
    opts: OpenModalOptions<Partial<Record<keyof C, unknown>>> = {},
  ): NgbModalRef {
    const { inputs, ...modalOpts } = opts;
    const ref = this.modal.open(component, {
      centered: true,
      animation: true,
      size: 'lg',
      ...modalOpts,
    });
    if (inputs) {
      applyModalInputs(component, ref, inputs as Record<string, unknown>);
    }
    return ref;
  }

  dismissAll(reason?: string): void {
    this.modal.dismissAll(reason);
  }
}
