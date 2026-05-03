import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonList,
} from '@ionic/angular/standalone';
import { Icon } from '../../atoms/icon/icon.js';
import { AppChip } from '../../atoms/app-chip/app-chip.js';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import {
  LessonItem,
  type LessonItemStatus,
  type LessonItemType,
} from '../../molecules/lesson-item/lesson-item.js';
import type { CourseCategoryRef } from '../../molecules/course-card/course-card.js';

export interface CoursePreviewLesson {
  id: string;
  title: string;
  type: LessonItemType;
  status: LessonItemStatus;
  estimateMinutes?: number | null;
  isFree?: boolean;
}

export interface CoursePreview {
  id: string;
  title: string;
  description: string;
  author?: string | null;
  lessonCount: number;
  estimatedMinutes?: number | null;
  difficulty?: string | null;
  categories?: CourseCategoryRef[];
  hasFreePreview?: boolean;
  premiumOnly?: boolean;
  curriculum: CoursePreviewLesson[];
}

/**
 * Bottom-sheet style modal that previews a course before enrolment. Shows
 * the description, taxonomy chips, lesson curriculum (first ~5 with a
 * "view all" affordance), and the primary CTA (Start / Continue / Unlock).
 *
 *   <cdf-course-preview-modal
 *     [open]="selectedPreview() !== null"
 *     [course]="selectedPreview()"
 *     (closed)="selectedPreview.set(null)"
 *     (startClicked)="enrol($event)"
 *   />
 *
 * Premium-locked courses emit `unlockClicked` instead of `startClicked`.
 */
@Component({
  selector: 'cdf-course-preview-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonList,
    Icon,
    AppChip,
    AppButton,
    AppBadge,
    LessonItem,
  ],
  template: `
    <ion-modal
      [isOpen]="open()"
      [breakpoints]="[0, 0.6, 1]"
      [initialBreakpoint]="0.6"
      handleBehavior="cycle"
      (didDismiss)="closed.emit()"
    >
      <ng-template>
        @if (course(); as c) {
        <ion-header>
          <ion-toolbar>
            <ion-title>{{ c.title }}</ion-title>
            <ion-buttons slot="end">
              <cdf-app-button
                kind="ghost"
                size="sm"
                aria-label="Close preview"
                (buttonClick)="closed.emit()"
              >
                <cdf-icon name="close" size="md" />
              </cdf-app-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>

        <ion-content class="ion-padding">
          <header class="cdf-preview__header">
            @if (c.author) {
            <p class="cdf-preview__author">by {{ c.author }}</p>
            }
            @if (c.premiumOnly) {
            <cdf-app-badge variant="premium" [subtle]="true">Premium</cdf-app-badge>
            } @else if (c.hasFreePreview) {
            <cdf-app-badge variant="success" [subtle]="true">Free preview</cdf-app-badge>
            }
          </header>

          <p class="cdf-preview__desc">{{ c.description }}</p>

          @if ((c.categories?.length ?? 0) > 0) {
          <div class="cdf-preview__chips">
            @for (cat of c.categories; track cat.id) {
            <cdf-app-chip variant="primary" [outline]="true">{{ cat.label }}</cdf-app-chip>
            }
          </div>
          }

          <div class="cdf-preview__meta">
            <span><cdf-icon name="school" size="xs" /> {{ c.lessonCount }} lessons</span>
            @if (c.estimatedMinutes) {
            <span><cdf-icon name="hourglass" size="xs" /> {{ duration() }}</span>
            }
            @if (c.difficulty) {
            <span><cdf-icon name="ribbon" size="xs" /> {{ c.difficulty }}</span>
            }
          </div>

          <h3 class="cdf-preview__section-title">Curriculum</h3>
          <ion-list inset="true">
            @for (lesson of visibleLessons(); track lesson.id) {
            <cdf-lesson-item
              [title]="lesson.title"
              [type]="lesson.type"
              [status]="lesson.status"
              [estimateMinutes]="lesson.estimateMinutes ?? null"
              [isFree]="!!lesson.isFree"
            />
            }
          </ion-list>

          @if (hasMoreLessons()) {
          <p class="cdf-preview__more">
            +{{ moreCount() }} more {{ moreCount() === 1 ? 'lesson' : 'lessons' }}
          </p>
          }

          <div class="cdf-preview__cta">
            @if (c.premiumOnly) {
            <cdf-app-button kind="primary" (buttonClick)="unlockClicked.emit(c.id)">
              Unlock with Premium
            </cdf-app-button>
            } @else {
            <cdf-app-button kind="primary" (buttonClick)="startClicked.emit(c.id)">
              Start course
            </cdf-app-button>
            }
          </div>
        </ion-content>
        }
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './course-preview-modal.scss',
})
export class CoursePreviewModal {
  readonly open = input.required<boolean>();
  readonly course = input<CoursePreview | null>(null);
  /** Number of curriculum rows shown before "+N more". */
  readonly maxLessons = input(5);

  readonly closed = output<void>();
  readonly startClicked = output<string>();
  readonly unlockClicked = output<string>();

  protected readonly visibleLessons = computed(() => {
    const c = this.course();
    if (!c) return [];
    return c.curriculum.slice(0, this.maxLessons());
  });

  protected readonly hasMoreLessons = computed(() => {
    const c = this.course();
    if (!c) return false;
    return c.curriculum.length > this.maxLessons();
  });

  protected readonly moreCount = computed(() => {
    const c = this.course();
    if (!c) return 0;
    return Math.max(0, c.curriculum.length - this.maxLessons());
  });

  protected readonly duration = computed(() => {
    const m = this.course()?.estimatedMinutes ?? 0;
    if (!m) return '';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  });
}
