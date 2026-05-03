import { Injectable, inject, type Type } from '@angular/core';
import { NgbModal, type NgbModalOptions, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

export interface OpenModalOptions<TInputs = unknown> extends NgbModalOptions {
  /**
   * Properties set on the component instance after creation. Use for passing
   * data into the modal: `inputs: { course }`.
   */
  inputs?: TInputs;
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

  open<C extends object, R = unknown>(
    component: Type<C>,
    opts: OpenModalOptions<Partial<C>> = {},
  ): NgbModalRef {
    const { inputs, ...modalOpts } = opts;
    const ref = this.modal.open(component, {
      centered: true,
      animation: true,
      size: 'lg',
      ...modalOpts,
    });
    if (inputs) {
      Object.assign(ref.componentInstance as C, inputs);
    }
    return ref;
  }

  dismissAll(reason?: string): void {
    this.modal.dismissAll(reason);
  }
}
