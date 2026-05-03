import { Component, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

/**
 * Standard modal scaffold: header (title + close), scrollable body, optional
 * footer slot. Wrap any modal content with this for consistent chrome:
 *
 *   <cdf-modal-frame title="Edit course">
 *     ...your form...
 *     <div modalFooter>
 *       <cdf-button kind="ghost">Cancel</cdf-button>
 *       <cdf-button kind="primary">Save</cdf-button>
 *     </div>
 *   </cdf-modal-frame>
 */
@Component({
  selector: 'cdf-modal-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton],
  template: `
    <div class="cdf-modal">
      <header class="cdf-modal__head">
        <h2 class="cdf-modal__title">{{ title() }}</h2>
        <cdf-icon-button
          icon="x"
          ariaLabel="Close"
          kind="ghost"
          size="sm"
          (click)="modal.dismiss('close')"
        />
      </header>

      <div class="cdf-modal__body">
        <ng-content />
      </div>

      <footer class="cdf-modal__foot">
        <ng-content select="[modalFooter]" />
      </footer>
    </div>
  `,
  styleUrl: './modal-frame.scss',
})
export class ModalFrame {
  readonly title = input.required<string>();
  protected readonly modal = inject(NgbActiveModal);
}
