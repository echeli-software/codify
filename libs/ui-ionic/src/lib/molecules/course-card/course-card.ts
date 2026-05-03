import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { AppCard } from '../../atoms/app-card/app-card.js';
import { AppChip } from '../../atoms/app-chip/app-chip.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import { Icon } from '../../atoms/icon/icon.js';

export interface CourseCategoryRef {
  id: string;
  label: string;
}

/**
 * Catalog tile for a course. Used on the catalog grid (mobile 1 col,
 * sm 2 col, md 3 col, lg 4 col per docs/05-student-app §1) and on Today
 * for "recommended next" rows.
 *
 *   <cdf-course-card
 *     title="React Fundamentals"
 *     author="Maria S."
 *     [lessonCount]="12"
 *     [estimatedMinutes]="180"
 *     [categories]="[{id:'frontend', label:'Frontend'}]"
 *     [hasFreePreview]="true"
 *     difficulty="Intermediário"
 *   />
 */
@Component({
  selector: 'cdf-course-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppCard, AppChip, AppBadge, Icon],
  template: `
    <cdf-app-card padding="normal">
      <header class="cdf-course-card__head">
        <div>
          <h3 class="cdf-course-card__title">{{ title() }}</h3>
          @if (author()) {
          <p class="cdf-course-card__author">by {{ author() }}</p>
          }
        </div>
        @if (premiumOnly()) {
        <cdf-app-badge variant="premium" [subtle]="true">Premium</cdf-app-badge>
        }
      </header>

      @if (categories().length > 0) {
      <div class="cdf-course-card__categories">
        @for (cat of categories(); track cat.id) {
        <cdf-app-chip variant="primary" [outline]="true">{{ cat.label }}</cdf-app-chip>
        }
      </div>
      }

      <div class="cdf-course-card__meta">
        <span class="meta-item">
          <cdf-icon name="school" size="xs" />
          {{ lessonCount() }} {{ lessonCount() === 1 ? 'lesson' : 'lessons' }}
        </span>
        @if (estimatedMinutes()) {
        <span class="meta-item">
          <cdf-icon name="hourglass" size="xs" />
          {{ formattedDuration() }}
        </span>
        }
        @if (difficulty()) {
        <span class="meta-item">
          <cdf-icon name="ribbon" size="xs" />
          {{ difficulty() }}
        </span>
        }
      </div>

      @if (hasFreePreview()) {
      <cdf-app-badge variant="success" [subtle]="true">
        <cdf-icon name="gift" size="xs" /> Free preview
      </cdf-app-badge>
      }
    </cdf-app-card>
  `,
  styleUrl: './course-card.scss',
})
export class CourseCard {
  readonly title = input.required<string>();
  readonly author = input<string | null>(null);
  readonly lessonCount = input.required<number>();
  readonly estimatedMinutes = input<number | null>(null);
  readonly difficulty = input<string | null>(null);
  readonly categories = input<CourseCategoryRef[]>([]);
  readonly hasFreePreview = input(false);
  readonly premiumOnly = input(false);

  protected readonly formattedDuration = computed(() => {
    const m = this.estimatedMinutes();
    if (!m) return '';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  });
}
