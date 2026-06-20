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
  BillingClient,
  CoursesClient,
  PlansClient,
  type CourseDetail,
  type LessonType,
  type Plan,
  ProgressClient,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  EmptyState,
  Icon,
  LessonItem,
  type LessonItemStatus,
  type LessonItemType,
  PaywallSheet,
  type PaywallContent,
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
    AppButton,
    AppCard,
    AppSkeleton,
    EmptyState,
    Icon,
    LessonItem,
    PaywallSheet,
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

      <!-- Paywall: shown when this course has paid lessons the user can't
           yet open. Lists the plans that include this course. -->
      @if (showPaywall()) {
      <cdf-app-card padding="normal" class="paywall-banner" data-testid="course-paywall">
        <div class="paywall-banner__head">
          <cdf-icon name="diamond" size="md" />
          <div>
            <h2>Subscribe to continue</h2>
            <p class="muted">
              {{ paidCount() }} {{ paidCount() === 1 ? 'lesson is' : 'lessons are' }}
              premium. Any plan below unlocks this course.
            </p>
          </div>
        </div>
        <ul class="paywall-banner__plans" data-testid="plans-including-course">
          @for (plan of plansForCourse(); track plan.id) {
          <li [attr.data-plan-id]="plan.id">
            <span class="plan-name">{{ plan.name }}</span>
            <span class="muted">{{ planPriceSummary(plan) }}</span>
          </li>
          }
        </ul>
        <cdf-app-button kind="primary" [fullWidth]="true" (buttonClick)="paywallOpen.set(true)" data-testid="open-paywall-btn">
          See plans
        </cdf-app-button>
      </cdf-app-card>
      } @else if (hasAccessBadge()) {
      <cdf-app-badge variant="success" [subtle]="true" data-testid="access-badge">
        <cdf-icon name="shield-checkmark" size="xs" /> Included in your plan
      </cdf-app-badge>
      }

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
            [status]="lessonStatus(l.id, l.isFree)"
            [isFree]="l.isFree"
            [estimateMinutes]="l.estimatedMinutes || null"
            [routerLink]="lessonLink(l.id, l.isFree)"
            [attr.data-lesson-id]="l.id"
            [attr.data-lesson-free]="l.isFree"
            [attr.data-lesson-completed]="completedIds().has(l.id)"
          />
          }
        </ion-item-group>
        }
      </ion-list>
      } }

      @if (paywallContent(); as pc) {
      <cdf-paywall-sheet
        reason="course-locked"
        [open]="paywallOpen()"
        [content]="pc"
        (dismissed)="paywallOpen.set(false)"
        (selected)="subscribe($event)"
      />
      }
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
      .paywall-banner {
        margin-bottom: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-border, rgba(0, 0, 0, 0.1));
      }
      .paywall-banner__head {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
      }
      .paywall-banner__head h2 {
        margin: 0 0 2px;
        font-size: var(--cdf-font-size-md);
      }
      .paywall-banner__plans {
        list-style: none;
        padding: 0;
        margin: var(--cdf-space-2) 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .paywall-banner__plans li {
        display: flex;
        justify-content: space-between;
        gap: var(--cdf-space-2);
      }
      .paywall-banner__plans .plan-name {
        font-weight: 600;
      }
      .muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
    `,
  ],
})
export class CourseDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly coursesClient = inject(CoursesClient);
  private readonly progressClient = inject(ProgressClient);
  private readonly plansClient = inject(PlansClient);
  private readonly billing = inject(BillingClient);

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly course = signal<CourseDetail | null>(null);
  /** Lessons in this course the current user has completed. */
  protected readonly completedIds = signal<Set<string>>(new Set());
  /** Active plans that unlock this course (the "plans including this course"). */
  protected readonly plansForCourse = signal<readonly Plan[]>([]);
  /** Plan ids the user currently has access through. */
  protected readonly activePlanIds = signal<Set<string>>(new Set());
  protected readonly paywallOpen = signal(false);

  private readonly allLessons = computed(
    () => this.course()?.modules.flatMap((m) => m.lessons) ?? [],
  );

  protected readonly freeCount = computed(
    () => this.allLessons().filter((l) => l.isFree).length,
  );

  protected readonly paidCount = computed(
    () => this.allLessons().filter((l) => !l.isFree).length,
  );

  /** True when every lesson in the course is free (no gate at all). */
  private readonly allLessonsFree = computed(
    () => this.allLessons().length > 0 && this.paidCount() === 0,
  );

  /** Does the user already have access to this course's paid lessons? */
  protected readonly hasCourseAccess = computed(() => {
    if (this.allLessonsFree()) return true;
    const active = this.activePlanIds();
    return this.plansForCourse().some((p) => active.has(p.id));
  });

  /** Show the paywall banner: paid lessons exist, no access yet, plans offered. */
  protected readonly showPaywall = computed(
    () => this.paidCount() > 0 && !this.hasCourseAccess() && this.plansForCourse().length > 0,
  );

  /** Subtle "included in your plan" badge when access is via a subscription. */
  protected readonly hasAccessBadge = computed(
    () => this.paidCount() > 0 && this.hasCourseAccess() && !this.allLessonsFree(),
  );

  protected readonly paywallContent = computed<PaywallContent | null>(() => {
    const plans = this.plansForCourse();
    if (plans.length === 0) return null;
    const planEntries = plans.flatMap((plan) =>
      plan.prices.map((price) => ({
        id: price.id,
        name: plan.name,
        cadence: (price.period === 'ANNUAL' ? 'yearly' : 'monthly') as 'monthly' | 'yearly',
        priceLabel: formatPrice(
          {
            currency: price.currency,
            amountCents: price.amountCents,
            period: price.period,
            maxInstallments: price.maxInstallments,
          },
          'pt-BR',
        ),
        highlight: plan.isAllAccess,
      })),
    );
    return {
      title: 'Unlock the full course',
      subtitle: 'Subscribe to open every lesson in this course.',
      perks: [
        'Every premium lesson in this course',
        'XP multiplier on Premium',
        'Offline reading + streak protection',
      ],
      plans: planEntries,
    };
  });

  protected readonly completedCount = computed(() => this.completedIds().size);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const slug = pm.get('slug');
      if (slug) void this.load(slug);
    });
  }

  private async load(slug: string): Promise<void> {
    this.loading.set(true);
    this.notFound.set(false);
    this.completedIds.set(new Set());
    this.plansForCourse.set([]);
    this.activePlanIds.set(new Set());
    try {
      const detail = await this.coursesClient.detail(slug);
      this.course.set(detail);
      // Best-effort side loads — curriculum still renders if any fail.
      const [, plans, mine] = await Promise.allSettled([
        this.progressClient
          .forCourse(detail.id)
          .then((cp) => this.completedIds.set(new Set(cp.items.map((i) => i.lessonId)))),
        this.plansClient.list({ courseId: detail.id }),
        this.billing.mySubscription(),
      ]);
      if (plans.status === 'fulfilled') this.plansForCourse.set(plans.value.items);
      if (mine.status === 'fulfilled') {
        this.activePlanIds.set(new Set(mine.value.activePlanIds));
      }
    } catch {
      this.notFound.set(true);
      this.course.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected planPriceSummary(plan: Plan): string {
    const price = plan.prices[0];
    if (!price) return '';
    return formatPrice(
      {
        currency: price.currency,
        amountCents: price.amountCents,
        period: price.period,
        maxInstallments: price.maxInstallments,
      },
      'pt-BR',
    );
  }

  /** Start checkout for the chosen plan price; redirect to the provider URL. */
  protected async subscribe(planPriceId: string): Promise<void> {
    this.paywallOpen.set(false);
    try {
      const res = await this.billing.createCheckout({ planPriceId, paymentMethod: 'card' });
      window.location.href = res.url;
    } catch {
      // Surfaced by the global toast/problem-details interceptor.
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

  protected lessonStatus(id: string, isFree: boolean): LessonItemStatus {
    if (this.completedIds().has(id)) return 'completed';
    // A paid lesson is unlocked once the user has course access (subscription
    // or fully-free course); otherwise it stays locked behind the paywall.
    return isFree || this.hasCourseAccess() ? 'not-started' : 'locked';
  }

  protected lessonLink(id: string, isFree: boolean): string[] | null {
    return isFree || this.hasCourseAccess() ? ['/lessons', id] : null;
  }
}
