import { Directive } from '@angular/core';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';

/**
 * Tooltip directive. Thin wrapper over ng-bootstrap's NgbTooltip with
 * Codify-themed defaults. Apply to any element:
 *
 *   <button [cdfTooltip]="'Save (Cmd-S)'">…</button>
 */
@Directive({
  selector: '[cdfTooltip]',
  hostDirectives: [
    {
      directive: NgbTooltip,
      inputs: [
        'ngbTooltip: cdfTooltip',
        'placement: cdfTooltipPlacement',
        'tooltipClass: cdfTooltipClass',
        'openDelay: cdfTooltipOpenDelay',
      ],
    },
  ],
})
export class Tooltip {}
