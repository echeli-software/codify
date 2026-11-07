import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  output,
  ElementRef,
  viewChild,
} from '@angular/core';
import { teardownOverlayOnDestroy } from '../../internal/overlay-teardown.js';
import { TranslatePipe, I18nService } from '@codify/i18n';
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
import {
  formatMinutes,
  type CourseCategoryRef,
} from '../../molecules/course-card/course-card.js';

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
    TranslatePipe,
  ],
  template: `
    <ion-modal
      #modal
      [isOpen]="open()"
      [attr.aria-label]="course()?.title ?? ''"
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
                  [ariaLabel]="'ui.coursePreview.close' | translate"
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
                <p class="cdf-preview__author">
                  {{ 'ui.course.byAuthor' | translate: { author: c.author } }}
                </p>
              }
              @if (c.premiumOnly) {
                <cdf-app-badge variant="premium" [subtle]="true">{{
                  'billing.premiumOnly' | translate
                }}</cdf-app-badge>
              } @else if (c.hasFreePreview) {
                <cdf-app-badge variant="success" [subtle]="true">{{
                  'billing.freePreview' | translate
                }}</cdf-app-badge>
              }
            </header>

            <p class="cdf-preview__desc">{{ c.description }}</p>

            @if ((c.categories?.length ?? 0) > 0) {
              <div class="cdf-preview__chips">
                @for (cat of c.categories; track cat.id) {
                  <cdf-app-chip variant="primary" [outline]="true">{{
                    cat.label
                  }}</cdf-app-chip>
                }
              </div>
            }

            <div class="cdf-preview__meta">
              <span
                ><cdf-icon name="school" size="xs" />
                {{
                  'ui.course.lessons' | translate: { count: c.lessonCount }
                }}</span
              >
              @if (c.estimatedMinutes) {
                <span
                  ><cdf-icon name="hourglass" size="xs" />
                  {{ duration() }}</span
                >
              }
              @if (c.difficulty) {
                <span
                  ><cdf-icon name="ribbon" size="xs" /> {{ c.difficulty }}</span
                >
              }
            </div>

            <h3 class="cdf-preview__section-title">
              {{ 'ui.coursePreview.curriculum' | translate }}
            </h3>
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
                {{
                  'ui.coursePreview.moreLessons'
                    | translate: { count: moreCount() }
                }}
              </p>
            }

            <div class="cdf-preview__cta">
              @if (c.premiumOnly) {
                <cdf-app-button
                  kind="primary"
                  (buttonClick)="unlockClicked.emit(c.id)"
                >
                  {{ 'ui.coursePreview.unlock' | translate }}
                </cdf-app-button>
              } @else {
                <cdf-app-button
                  kind="primary"
                  (buttonClick)="startClicked.emit(c.id)"
                >
                  {{ 'ui.coursePreview.start' | translate }}
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
  private readonly modalRef = viewChild('modal', { read: ElementRef });

  constructor() {
    teardownOverlayOnDestroy(this.modalRef);
  }

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

  private readonly i18n = inject(I18nService);

  protected readonly duration = computed(() => {
    this.i18n.currentLocale();
    return formatMinutes(this.course()?.estimatedMinutes, (k, p) =>
      this.i18n.t(k, p),
    );
  });
}
