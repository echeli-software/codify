import { Component, ChangeDetectionStrategy } from '@angular/core';

/**
 * Keyboard key indicator. Wrap an individual keystroke or chord segment.
 *
 *   <cdf-kbd>Cmd</cdf-kbd> + <cdf-kbd>K</cdf-kbd>
 */
@Component({
  selector: 'cdf-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<kbd class="cdf-kbd"><ng-content /></kbd>`,
  styleUrl: './kbd.scss',
})
export class Kbd {}
