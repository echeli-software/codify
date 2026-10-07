import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe, I18nService } from '@codify/i18n';
import { AppCard } from '../../atoms/app-card/app-card.js';
import { AppChip } from '../../atoms/app-chip/app-chip.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import { Icon } from '../../atoms/icon/icon.js';

/** "45 min" / "2 h" / "2 h 30 min" through `ui.duration.*` keys. */
export function formatMinutes(
  minutes: number | null | undefined,
  t: (key: string, params: Record<string, unknown>) => string,
): string {
  if (!minutes || minutes <= 0) return '';
  if (minutes < 60) return t('ui.duration.minutes', { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? t('ui.duration.hoursMinutes', { h, m })
    : t('ui.duration.hours', { h });
}

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
  imports: [AppCard, AppChip, AppBadge, Icon, TranslatePipe],
  template: `
    <cdf-app-card padding="normal">
      <header class="cdf-course-card__head">
        <div>
          <h3 class="cdf-course-card__title">{{ title() }}</h3>
          @if (author()) {
            <p class="cdf-course-card__author">
              {{ 'ui.course.byAuthor' | translate: { author: author() } }}
            </p>
          }
        </div>
        @if (premiumOnly()) {
          <cdf-app-badge variant="premium" [subtle]="true">{{
            'billing.premiumOnly' | translate
          }}</cdf-app-badge>
        }
      </header>

      @if (categories().length > 0) {
        <div class="cdf-course-card__categories">
          @for (cat of categories(); track cat.id) {
            <cdf-app-chip variant="primary" [outline]="true">{{
              cat.label
            }}</cdf-app-chip>
          }
        </div>
      }

      <div class="cdf-course-card__meta">
        <span class="meta-item">
          <cdf-icon name="school" size="xs" />
          {{ 'ui.course.lessons' | translate: { count: lessonCount() } }}
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
          <cdf-icon name="gift" size="xs" />
          {{ 'billing.freePreview' | translate }}
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

  private readonly i18n = inject(I18nService);

  protected readonly formattedDuration = computed(() => {
    this.i18n.currentLocale();
    return formatMinutes(this.estimatedMinutes(), (k, p) => this.i18n.t(k, p));
  });
}
