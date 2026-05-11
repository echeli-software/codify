import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonList,
  IonItemGroup,
  IonItemDivider,
  IonLabel,
} from '@ionic/angular/standalone';
import {
  CoursesClient,
  type CourseDetail,
  type LessonType,
} from '@codify/api-client';
import {
  AppBadge,
  AppCard,
  AppSkeleton,
  EmptyState,
  Icon,
  LessonItem,
  type LessonItemStatus,
  type LessonItemType,
} from '@codify/ui-ionic';

const LESSON_TYPE_MAP: Record<LessonType, LessonItemType> = {
  READING: 'reading',
  QUIZ: 'quiz',
  EXERCISE: 'exercise',
  AI_PROMPT: 'ai-prompt',
  SCENARIO: 'scenario',
};

/**
 * Student course-detail / curriculum page. Reached by tapping a card on
 * the Catalog tab. Shows the course header (title, author, difficulty,
 * total lessons + minutes) plus modules → lesson rows. Each lesson row
 * routes to `/lessons/:id` and reflects its lock state:
 *  - `isFree` = unlocked for everyone
 *  - otherwise locked until enrollment exists (Phase 6 wires Enrollment;
 *    until then, anything non-free shows the lock).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonItemGroup,
    IonItemDivider,
    IonLabel,
    AppBadge,
    AppCard,
    AppSkeleton,
    EmptyState,
    Icon,
    LessonItem,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/catalog" />
        </ion-buttons>
        <ion-title>{{ course()?.title ?? 'Course' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <div class="course-skel">
        <cdf-app-skeleton shape="rect" />
        <cdf-app-skeleton shape="text" />
        <cdf-app-skeleton shape="text" />
      </div>
      } @else if (notFound()) {
      <cdf-empty-state
        icon="school"
        title="Course not found"
        description="It might have been unpublished. Head back to the catalog."
      />
      } @else if (course(); as c) {
      <cdf-app-card padding="normal" class="course-hero" data-testid="course-hero">
        <h1 class="course-hero__title">{{ c.title }}</h1>
        <p class="course-hero__meta">
          <cdf-icon name="person-circle" size="xs" /> {{ c.authorDisplayName }}
        </p>
        @if (c.description) {
        <p class="course-hero__desc">{{ c.description }}</p>
        }
        <div class="course-hero__stats">
          <span class="stat">
            <cdf-icon name="school" size="xs" />
            {{ c.lessonCount }} {{ c.lessonCount === 1 ? 'lesson' : 'lessons' }}
          </span>
          <span class="stat">
            <cdf-icon name="hourglass" size="xs" />
            {{ formatDuration(c.estimatedMinutes) }}
          </span>
          <span class="stat">
            <cdf-icon name="ribbon" size="xs" />
            Lvl {{ c.difficulty }}
          </span>
        </div>
        @if (freeCount() > 0) {
        <cdf-app-badge variant="success" [subtle]="true">
          <cdf-icon name="gift" size="xs" />
          {{ freeCount() }} free
        </cdf-app-badge>
        }
      </cdf-app-card>

      @if (c.modules.length === 0) {
      <cdf-empty-state
        icon="hourglass"
        title="Curriculum coming soon"
        description="The instructor hasn't published modules yet."
      />
      } @else {
      <ion-list class="course-curriculum" data-testid="course-curriculum">
        @for (m of c.modules; track m.id) {
        <ion-item-group>
          <ion-item-divider>
            <ion-label>{{ moduleHeading($index, m.title) }}</ion-label>
          </ion-item-divider>
          @for (l of m.lessons; track l.id) {
          <cdf-lesson-item
            [title]="l.title"
            [subtitle]="lessonSubtitle(l.order, m.lessons.length)"
            [type]="lessonType(l.type)"
            [status]="lessonStatus(l.isFree)"
            [isFree]="l.isFree"
            [estimateMinutes]="l.estimatedMinutes || null"
            [routerLink]="lessonLink(l.id, l.isFree)"
            [attr.data-lesson-id]="l.id"
            [attr.data-lesson-free]="l.isFree"
          />
          }
        </ion-item-group>
        }
      </ion-list>
      } }
    </ion-content>
  `,
  styles: [
    `
      .course-hero {
        margin-bottom: var(--cdf-space-3);
      }
      .course-hero__title {
        margin: 0 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-xl);
        font-weight: 700;
      }
      .course-hero__meta {
        margin: 0 0 var(--cdf-space-2);
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .course-hero__desc {
        margin: var(--cdf-space-1) 0;
        color: var(--cdf-color-text);
      }
      .course-hero__stats {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-3);
        margin: var(--cdf-space-2) 0;
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .course-hero__stats .stat {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .course-curriculum {
        padding: 0;
      }
      .course-skel {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
    `,
  ],
})
export class CourseDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly coursesClient = inject(CoursesClient);

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly course = signal<CourseDetail | null>(null);

  protected readonly freeCount = computed(
    () =>
      this.course()
        ?.modules.flatMap((m) => m.lessons)
        .filter((l) => l.isFree).length ?? 0,
  );

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const slug = pm.get('slug');
      if (slug) void this.load(slug);
    });
  }

  private async load(slug: string): Promise<void> {
    this.loading.set(true);
    this.notFound.set(false);
    try {
      const detail = await this.coursesClient.detail(slug);
      this.course.set(detail);
    } catch {
      this.notFound.set(true);
      this.course.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  protected moduleHeading(index: number, title: string): string {
    return `Module ${index + 1} · ${title}`;
  }

  protected lessonSubtitle(order: number, total: number): string {
    return `Lesson ${order + 1} of ${total}`;
  }

  protected lessonType(t: LessonType): LessonItemType {
    return LESSON_TYPE_MAP[t];
  }

  protected lessonStatus(isFree: boolean): LessonItemStatus {
    return isFree ? 'not-started' : 'locked';
  }

  protected lessonLink(id: string, isFree: boolean): string[] | null {
    return isFree ? ['/lessons', id] : null;
  }
}
