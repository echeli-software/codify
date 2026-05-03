import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { Icon, type IconName } from '../../atoms/icon/icon.js';

/**
 * Placeholder shown when a list/grid has no rows. Should always include a
 * CTA telling the user how to fill the void (per docs/04-admin-app §9).
 *
 *   <cdf-empty-state
 *     icon="plus"
 *     title="No courses yet"
 *     description="Start by creating your first course."
 *   >
 *     <cdf-button kind="primary">+ New course</cdf-button>
 *   </cdf-empty-state>
 */
@Component({
  selector: 'cdf-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="cdf-empty">
      @if (icon(); as i) {
      <div class="cdf-empty__icon">
        <cdf-icon [name]="i" size="xl" />
      </div>
      }
      @if (title(); as t) {
      <h2 class="cdf-empty__title">{{ t }}</h2>
      }
      @if (description(); as d) {
      <p class="cdf-empty__description">{{ d }}</p>
      }
      <div class="cdf-empty__actions">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  readonly icon = input<IconName | null>(null);
  readonly title = input<string | null>(null);
  readonly description = input<string | null>(null);
}
