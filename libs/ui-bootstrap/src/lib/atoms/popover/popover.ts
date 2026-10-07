import { Directive } from '@angular/core';
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap';

/**
 * Popover directive — ng-bootstrap's NgbPopover with Codify defaults. Use
 * for rich, interactive content anchored to a trigger (a tooltip is for
 * short, non-interactive hints):
 *
 *   <button cdfPopover [cdfPopover]="details" [cdfPopoverTitle]="'Plan' | translate">…</button>
 *   <ng-template #details>…</ng-template>
 *
 * ng-bootstrap wires `aria-describedby`, closes on Esc and outside click
 * (`autoClose`), and returns focus to the trigger.
 */
@Directive({
  selector: '[cdfPopover]',
  exportAs: 'cdfPopover',
  host: { class: 'cdf-popover-trigger' },
  hostDirectives: [
    {
      directive: NgbPopover,
      inputs: [
        'ngbPopover: cdfPopover',
        'popoverTitle: cdfPopoverTitle',
        'placement: cdfPopoverPlacement',
        'triggers: cdfPopoverTriggers',
        'autoClose: cdfPopoverAutoClose',
        'popoverClass: cdfPopoverClass',
        'disablePopover: cdfPopoverDisabled',
      ],
      outputs: ['shown: cdfPopoverShown', 'hidden: cdfPopoverHidden'],
    },
  ],
})
export class Popover {}
