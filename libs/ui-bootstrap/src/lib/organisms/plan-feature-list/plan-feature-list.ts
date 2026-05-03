import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { Badge } from '../../atoms/badge/badge.js';
import { Icon } from '../../atoms/icon/icon.js';

export interface PlanCategoryRef {
  id: string;
  label: string;
  /**
   * Optional color token id (e.g. 'frontend', 'mobile') used to drive the
   * chip color. Falls back to neutral when omitted.
   */
  colorToken?: string;
}

export interface PlanFeature {
  label: string;
  /** True for "✓ included", false for "✗ not included", null for hint-only. */
  included?: boolean;
  hint?: string;
}

/**
 * Bullet list of plan features + included-categories chips. Used on
 * subscription/pricing surfaces. See docs/04-admin-app §"Plans" and
 * docs/05-student-app §"Subscription".
 */
@Component({
  selector: 'cdf-plan-feature-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  template: `
    @if (categories().length > 0) {
    <div class="cdf-plan-features__categories">
      @for (cat of categories(); track cat.id) {
      <cdf-badge variant="primary" [subtle]="true">{{ cat.label }}</cdf-badge>
      }
    </div>
    } @if (features().length > 0) {
    <ul class="cdf-plan-features">
      @for (feature of features(); track feature.label) {
      <li class="cdf-plan-features__item" [class.cdf-plan-features__item--excluded]="feature.included === false">
        <cdf-icon
          [name]="feature.included === false ? 'x-circle' : 'check-circle'"
          size="sm"
          [class.cdf-plan-features__icon--ok]="feature.included !== false"
          [class.cdf-plan-features__icon--no]="feature.included === false"
        />
        <span class="cdf-plan-features__label">
          {{ feature.label }}
          @if (feature.hint) {
          <span class="cdf-plan-features__hint">— {{ feature.hint }}</span>
          }
        </span>
      </li>
      }
    </ul>
    }
  `,
  styleUrl: './plan-feature-list.scss',
})
export class PlanFeatureList {
  readonly features = input<PlanFeature[]>([]);
  readonly categories = input<PlanCategoryRef[]>([]);
}
