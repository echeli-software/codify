import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  BillingClient,
  CertificatesClient,
  CoursesClient,
  EnrollmentsClient,
  PlansClient,
  ProgressClient,
  type CourseDetail,
  type CourseLessonSummary,
  type LessonType,
  type MyEnrollment,
  type Plan,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';
import { ContentTranslatePipe, I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppCard,
  AppProgressBar,
  AppSkeleton,
  EmptyState,
  ErrorState,
  Icon,
  LessonItem,
  PaywallSheet,
  type LessonItemStatus,
  type LessonItemType,
  type PaywallContent,
} from '@codify/ui-ionic';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import {
  AppToastService,
  errorMessageKey,
} from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { classifyLoadError } from './lesson/lesson-state.js';
import { loadCourse, saveCourse } from './shared/course-cache.js';
import { paywallRows } from './shared/plan-view.js';

const LESSON_TYPE_MAP: Record<LessonType, LessonItemType> = {
  READING: 'reading',
  QUIZ: 'quiz',
  EXERCISE: 'exercise',
  AI_PROMPT: 'ai-prompt',
  SCENARIO: 'scenario',
  CAPSTONE: 'capstone',
};

/** Does the learner already have access to the course's paid lessons? */
export function courseAccess(opts: {
  paidLessons: number;
  plansForCourse: readonly Pick<Plan, 'id'>[];
  activePlanIds: ReadonlySet<string>;
  enrollmentGrantsAccess: boolean;
}): boolean {
  if (opts.paidLessons === 0) return true;
  if (opts.enrollmentGrantsAccess) return true;
  return opts.plansForCourse.some((p) => opts.activePlanIds.has(p.id));
}

/**
 * Course detail (docs/05 §3 Learn → Course detail): hero with enroll /
 * continue / see-plans actions, the plans that include the course, the
 * curriculum with per-module and per-lesson downloads, the course download
 * controls (download / pause / resume / update / remove), and the
 * certificate once every lesson is done. Offline it falls back to the last
 * cached copy so downloaded lessons stay reachable.
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
    AppButton,
    AppCard,
    AppProgressBar,
    AppSkeleton,
    EmptyState,
    ErrorState,
    Icon,
    LessonItem,
    PaywallSheet,
    TranslatePipe,
    ContentTranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/catalog"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{
          course() ? title() : ('student.course.title' | translate)
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="cd">
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="180" />
          <cdf-app-skeleton shape="rect" [height]="240" />
        } @else if (notFound()) {
          <cdf-empty-state
            icon="school"
            [title]="'student.course.notFound' | translate"
            [description]="'student.course.notFoundBody' | translate"
          >
            <cdf-app-button kind="primary" routerLink="/catalog">{{
              'student.myCourses.browse' | translate
            }}</cdf-app-button>
          </cdf-empty-state>
        } @else if (errorKey(); as e) {
          <cdf-error-state
            [title]="'student.course.loadError' | translate"
            [description]="e | translate"
            (retry)="reload()"
          />
        } @else if (course(); as c) {
          @if (fromCache()) {
            <p class="cd__offline" role="status" data-testid="course-cached">
              <cdf-icon name="cloud-offline" size="xs" />
              {{ 'student.course.cached' | translate }}
            </p>
          }

          <cdf-app-card
            padding="normal"
            class="cd__hero"
            data-testid="course-hero"
          >
            <h1>{{ title() }}</h1>
            <p class="cd__muted">
              {{
                'ui.course.byAuthor'
                  | translate: { author: c.authorDisplayName }
              }}
            </p>
            @if (c.description) {
              <p>
                {{ c.id | tContent: 'COURSE' : 'description' : c.description }}
              </p>
            }
            <ul class="cd__stats">
              <li>
                <cdf-icon name="school" size="xs" />
                {{ 'ui.course.lessons' | translate: { count: totalLessons() } }}
              </li>
              @if (c.estimatedMinutes) {
                <li>
                  <cdf-icon name="hourglass" size="xs" />
                  {{ duration(c.estimatedMinutes) }}
                </li>
              }
              @if (c.difficulty) {
                <li>
                  <cdf-icon name="ribbon" size="xs" />
                  {{
                    'student.catalog.level' | translate: { level: c.difficulty }
                  }}
                </li>
              }
              @if (freeCount() > 0) {
                <li>
                  <cdf-icon name="gift" size="xs" />
                  {{
                    'student.course.freeLessons'
                      | translate: { count: freeCount() }
                  }}
                </li>
              }
            </ul>

            @if (enrollment(); as en) {
              <cdf-app-progress-bar
                [value]="progressPct()"
                [label]="
                  'student.myCourses.progressLabel'
                    | translate: { title: title() }
                "
              />
              <p class="cd__muted">
                {{
                  'student.myCourses.progress'
                    | translate
                      : { done: completedIds().size, total: totalLessons() }
                }}
              </p>
            }

            <div class="cd__actions">
              @if (nextLesson(); as n) {
                <cdf-app-button
                  kind="primary"
                  [routerLink]="['/lessons', n.id]"
                  data-testid="course-continue"
                >
                  <cdf-icon name="play" size="sm" />
                  {{
                    (completedIds().size > 0
                      ? 'student.course.continue'
                      : hasAccess()
                        ? 'student.course.start'
                        : 'student.course.startPreview'
                    ) | translate
                  }}
                </cdf-app-button>
              }
              @if (!hasAccess() && plansForCourse().length > 0) {
                <cdf-app-button
                  kind="secondary"
                  (buttonClick)="openPaywall()"
                  data-testid="open-paywall-btn"
                >
                  <cdf-icon name="diamond" size="sm" />
                  {{ 'student.course.seePlans' | translate }}
                </cdf-app-button>
              }
              @if (enrollment(); as en) {
                @if (en.source === 'SELF') {
                  <cdf-app-button
                    kind="ghost"
                    size="sm"
                    [disabled]="!online()"
                    [loading]="enrolling()"
                    (buttonClick)="unenroll()"
                    data-testid="unenroll-btn"
                  >
                    {{ 'student.course.unenroll' | translate }}
                  </cdf-app-button>
                }
              } @else {
                <cdf-app-button
                  kind="secondary"
                  [disabled]="!online()"
                  [loading]="enrolling()"
                  (buttonClick)="enroll()"
                  data-testid="enroll-btn"
                >
                  <cdf-icon name="bookmark" size="sm" />
                  {{ 'student.course.enroll' | translate }}
                </cdf-app-button>
              }
            </div>
          </cdf-app-card>

          <!-- Plans that include this course -->
          @if (plansForCourse().length > 0) {
            <section
              class="cd__plans"
              aria-labelledby="cd-plans"
              data-testid="plans-including-course"
            >
              <h2 id="cd-plans">
                {{ 'student.course.plansTitle' | translate }}
              </h2>
              @if (hasAccess() && paidCount() > 0) {
                <p class="cd__access" data-testid="access-badge">
                  <cdf-icon name="shield-checkmark" size="xs" />
                  {{ 'student.course.included' | translate }}
                </p>
              }
              <ul class="cd__chips">
                @for (p of plansForCourse(); track p.id) {
                  <li>
                    <button
                      type="button"
                      class="cd__chip"
                      [attr.aria-pressed]="activePlanIds().has(p.id)"
                      [attr.data-plan-id]="p.id"
                      (click)="openPaywall(p.id)"
                    >
                      {{ p.name }}
                      @if (cheapest(p); as price) {
                        <span class="cd__chip-price">{{ price }}</span>
                      }
                    </button>
                  </li>
                }
              </ul>
            </section>
          }

          <!-- Certificate -->
          @if (allComplete()) {
            <cdf-app-card
              padding="normal"
              class="cd__cert"
              data-testid="course-certificate"
            >
              @if (certificate(); as cert) {
                <p>
                  <cdf-icon name="trophy-outline" size="sm" />
                  {{ 'student.course.certEarned' | translate }}
                </p>
                <cdf-app-button
                  kind="primary"
                  size="sm"
                  [routerLink]="['/verify', cert.serial]"
                  data-testid="view-certificate"
                >
                  {{ 'student.course.viewCert' | translate }}
                </cdf-app-button>
              } @else {
                <p>
                  <cdf-icon name="trophy-outline" size="sm" />
                  {{ 'student.course.finished' | translate }}
                </p>
                <cdf-app-button
                  kind="primary"
                  size="sm"
                  [disabled]="!online()"
                  [loading]="claiming()"
                  (buttonClick)="claimCertificate()"
                  data-testid="claim-certificate"
                >
                  {{ 'student.course.claimCert' | translate }}
                </cdf-app-button>
              }
            </cdf-app-card>
          }

          <!-- Offline download -->
          <cdf-app-card
            padding="normal"
            class="cd__dl"
            data-testid="download-control"
            [attr.data-state]="dl().state"
          >
            <div class="cd__dl-head">
              <cdf-icon name="download" size="md" />
              <div class="cd__dl-copy">
                <h2>{{ 'student.course.download.title' | translate }}</h2>
                <p class="cd__muted" role="status">{{ downloadLine() }}</p>
              </div>
            </div>
            @if (dl().state === 'downloading') {
              <cdf-app-progress-bar
                [value]="dl().pct"
                [label]="'student.course.download.progressLabel' | translate"
              />
            }
            <div class="cd__actions">
              @switch (dl().state) {
                @case ('downloading') {
                  <cdf-app-button
                    kind="secondary"
                    size="sm"
                    (buttonClick)="pauseDownload()"
                    data-testid="download-pause"
                  >
                    {{ 'student.course.download.pause' | translate }}
                  </cdf-app-button>
                  <cdf-app-button
                    kind="ghost"
                    size="sm"
                    (buttonClick)="cancelDownload()"
                    data-testid="download-cancel"
                  >
                    {{ 'common.cancel' | translate }}
                  </cdf-app-button>
                }
                @case ('paused') {
                  <cdf-app-button
                    kind="primary"
                    size="sm"
                    [disabled]="!online()"
                    (buttonClick)="resumeDownload()"
                    data-testid="download-resume"
                  >
                    {{ 'student.course.download.resume' | translate }}
                  </cdf-app-button>
                }
                @case ('waitingForWifi') {
                  <cdf-app-button
                    kind="primary"
                    size="sm"
                    [disabled]="!online()"
                    (buttonClick)="resumeDownload()"
                    data-testid="download-resume"
                  >
                    {{ 'student.course.download.resume' | translate }}
                  </cdf-app-button>
                }
                @case ('needsSpace') {
                  <cdf-app-button
                    kind="secondary"
                    size="sm"
                    routerLink="/downloads"
                  >
                    {{ 'student.course.download.manage' | translate }}
                  </cdf-app-button>
                }
                @default {
                  @if (dl().state !== 'complete') {
                    <cdf-app-button
                      kind="primary"
                      size="sm"
                      [disabled]="!online()"
                      (buttonClick)="downloadCourse()"
                      data-testid="download-btn"
                    >
                      {{
                        (dl().state === 'partial'
                          ? 'student.course.download.complete'
                          : 'student.course.download.all'
                        ) | translate
                      }}
                    </cdf-app-button>
                  }
                  @if (dl().updateAvailable) {
                    <cdf-app-button
                      kind="secondary"
                      size="sm"
                      [disabled]="!online()"
                      (buttonClick)="updateDownload()"
                      data-testid="download-update"
                    >
                      {{
                        'student.course.download.update'
                          | translate: { count: dl().changedLessons }
                      }}
                    </cdf-app-button>
                  }
                  @if (dl().state === 'complete' || dl().state === 'partial') {
                    <cdf-app-button
                      kind="ghost"
                      size="sm"
                      (buttonClick)="removeDownload()"
                      data-testid="download-remove"
                    >
                      {{ 'common.remove' | translate }}
                    </cdf-app-button>
                  }
                }
              }
            </div>
          </cdf-app-card>

          <!-- Curriculum -->
          @if (c.modules.length === 0) {
            <cdf-empty-state
              icon="hourglass"
              [title]="'student.course.noModules' | translate"
              [description]="'student.course.noModulesBody' | translate"
            />
          } @else {
            <section
              class="cd__curriculum"
              aria-labelledby="cd-curriculum"
              data-testid="course-curriculum"
            >
              <h2 id="cd-curriculum">
                {{ 'student.course.curriculum' | translate }}
              </h2>
              @for (m of c.modules; track m.id; let mi = $index) {
                <section
                  class="cd__module"
                  [attr.aria-labelledby]="'mod-' + m.id"
                >
                  <header class="cd__module-head">
                    <h3 [id]="'mod-' + m.id">
                      {{
                        'student.course.module'
                          | translate
                            : {
                                n: mi + 1,
                                title:
                                  (m.id
                                  | tContent: 'MODULE' : 'title' : m.title),
                              }
                      }}
                    </h3>
                    <cdf-app-button
                      kind="ghost"
                      size="sm"
                      [disabled]="!online() || moduleDownloaded(m.lessons)"
                      [ariaLabel]="
                        'student.course.download.moduleNamed'
                          | translate: { title: m.title }
                      "
                      (buttonClick)="downloadModule(m.id)"
                      [attr.data-testid]="'download-module-' + m.id"
                    >
                      <cdf-icon
                        [name]="
                          moduleDownloaded(m.lessons)
                            ? 'check-circle'
                            : 'download'
                        "
                        size="sm"
                      />
                      {{
                        (moduleDownloaded(m.lessons)
                          ? 'student.course.download.saved'
                          : 'student.course.download.module'
                        ) | translate
                      }}
                    </cdf-app-button>
                  </header>
                  <ul class="cd__lessons">
                    @for (l of m.lessons; track l.id; let li = $index) {
                      <li
                        class="cd__lesson"
                        [attr.data-lesson-id]="l.id"
                        [attr.data-lesson-free]="l.isFree"
                        [attr.data-lesson-completed]="completedIds().has(l.id)"
                        [attr.data-lesson-locked]="lessonStatus(l) === 'locked'"
                      >
                        <cdf-lesson-item
                          class="cd__lesson-item"
                          [title]="
                            l.id | tContent: 'LESSON' : 'title' : l.title
                          "
                          [subtitle]="lessonSubtitle(l, li, m.lessons.length)"
                          [type]="lessonType(l.type)"
                          [status]="lessonStatus(l)"
                          [isFree]="l.isFree && paidCount() > 0"
                          [estimateMinutes]="l.estimatedMinutes || null"
                          [routerLink]="['/lessons', l.id]"
                        />
                        @if (downloadedLessons().has(l.id)) {
                          <span
                            class="cd__saved"
                            [attr.aria-label]="
                              'student.course.download.lessonSaved' | translate
                            "
                          >
                            <cdf-icon name="check-circle" size="sm" />
                          </span>
                        } @else if (canDownloadLesson(l)) {
                          <button
                            type="button"
                            class="cd__dl-lesson"
                            [disabled]="!online() || lessonBusy() === l.id"
                            [attr.aria-label]="
                              'student.course.download.lessonNamed'
                                | translate: { title: l.title }
                            "
                            (click)="downloadLesson(l.id)"
                            [attr.data-testid]="'download-lesson-' + l.id"
                          >
                            <cdf-icon name="download" size="sm" />
                          </button>
                        }
                      </li>
                    }
                  </ul>
                </section>
              }
            </section>
          }
        }

        @if (paywallContent(); as pc) {
          <cdf-paywall-sheet
            reason="course-locked"
            [open]="paywallOpen()"
            [content]="pc"
            (dismissed)="paywallOpen.set(false)"
            (selected)="choosePrice($event)"
          />
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .cd {
        max-width: 860px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      h1 {
        margin: 0 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-xl);
      }
      h2 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .cd__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 2px 0 var(--cdf-space-2);
      }
      .cd__offline {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0;
      }
      .cd__stats {
        list-style: none;
        padding: 0;
        margin: var(--cdf-space-2) 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-3);
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .cd__stats li {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .cd__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-2);
      }
      .cd__access {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        color: var(--cdf-color-success);
        font-size: var(--cdf-font-size-sm);
        margin: 0 0 var(--cdf-space-2);
      }
      .cd__chips {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
      .cd__chip {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        border: 1px solid var(--cdf-color-primary);
        color: var(--cdf-color-primary);
        background: transparent;
        border-radius: 999px;
        padding: 6px 12px;
        font: inherit;
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
        cursor: pointer;
        min-height: 36px;
      }
      .cd__chip[aria-pressed='true'] {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-on-primary, #fff);
      }
      .cd__chip-price {
        font-weight: 400;
        opacity: 0.85;
      }
      .cd__chip:focus-visible,
      .cd__dl-lesson:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .cd__dl-head {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
      }
      .cd__dl-copy h2 {
        margin: 0;
      }
      .cd__module {
        margin-bottom: var(--cdf-space-3);
      }
      .cd__module-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cdf-space-2);
        border-bottom: 1px solid var(--cdf-color-border);
        padding-bottom: 4px;
      }
      .cd__module-head h3 {
        margin: 0;
        font-size: var(--cdf-font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .cd__lessons {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .cd__lesson {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .cd__lesson-item {
        flex: 1;
        min-width: 0;
      }
      .cd__dl-lesson,
      .cd__saved {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 0;
        background: transparent;
        color: var(--cdf-color-text-muted);
        cursor: pointer;
      }
      .cd__saved {
        color: var(--cdf-color-success);
        cursor: default;
      }
    `,
  ],
})
export class CourseDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly coursesClient = inject(CoursesClient);
  private readonly progressClient = inject(ProgressClient);
  private readonly certs = inject(CertificatesClient);
  private readonly plansClient = inject(PlansClient);
  private readonly billing = inject(BillingClient);
  private readonly enrollments = inject(EnrollmentsClient);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);

  protected readonly online = this.network.online;
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly fromCache = signal(false);
  protected readonly course = signal<CourseDetail | null>(null);
  protected readonly completedIds = signal<Set<string>>(new Set());
  protected readonly plansForCourse = signal<readonly Plan[]>([]);
  protected readonly activePlanIds = signal<Set<string>>(new Set());
  protected readonly enrollment = signal<MyEnrollment | null>(null);
  protected readonly enrolling = signal(false);
  protected readonly paywallOpen = signal(false);
  protected readonly paywallPlanId = signal<string | null>(null);
  protected readonly certificate = signal<{ serial: string } | null>(null);
  protected readonly claiming = signal(false);
  protected readonly downloadedLessons = signal<Set<string>>(new Set());
  protected readonly lessonBusy = signal<string | null>(null);
  private readonly courseId = signal<string>('');

  protected readonly dl = computed(() =>
    this.downloads.status(this.courseId())(),
  );

  protected readonly title = computed(() => {
    const c = this.course();
    this.i18n.currentLocale();
    return c
      ? this.i18n.tContent('COURSE', c.id, 'title', { fallback: c.title })
      : '';
  });
  private readonly allLessons = computed(
    () => this.course()?.modules.flatMap((m) => m.lessons) ?? [],
  );
  protected readonly totalLessons = computed(() => this.allLessons().length);
  protected readonly freeCount = computed(
    () => this.allLessons().filter((l) => l.isFree).length,
  );
  protected readonly paidCount = computed(
    () => this.allLessons().filter((l) => !l.isFree).length,
  );
  protected readonly hasAccess = computed(() =>
    courseAccess({
      paidLessons: this.paidCount(),
      plansForCourse: this.plansForCourse(),
      activePlanIds: this.activePlanIds(),
      enrollmentGrantsAccess: this.enrollment()?.grantsAccess === true,
    }),
  );
  protected readonly allComplete = computed(
    () =>
      this.totalLessons() > 0 &&
      this.allLessons().every((l) => this.completedIds().has(l.id)),
  );
  protected readonly progressPct = computed(() =>
    this.totalLessons()
      ? Math.round((this.completedIds().size / this.totalLessons()) * 100)
      : 0,
  );
  /** First lesson not done yet that the learner can open (or preview). */
  protected readonly nextLesson = computed<CourseLessonSummary | null>(() => {
    const done = this.completedIds();
    const open = this.allLessons().filter((l) => !done.has(l.id));
    return open.find((l) => l.isFree || this.hasAccess()) ?? null;
  });
  protected readonly downloadLine = computed(() => {
    const s = this.dl();
    this.i18n.currentLocale();
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t(k, p);
    switch (s.state) {
      case 'downloading':
        return t('student.course.download.downloading', {
          current: s.current,
          total: s.total,
        });
      case 'paused':
        return t('student.course.download.paused', {
          current: s.current,
          total: s.total,
        });
      case 'waitingForWifi':
        return t('student.course.download.waitingWifi');
      case 'needsSpace':
        return t('student.course.download.needsSpace');
      case 'error':
        return t('student.course.download.error');
      case 'partial':
        return t('student.course.download.partial', {
          count: s.lessonCount,
          total: this.totalLessons(),
        });
      case 'complete':
        return s.updateAvailable
          ? t('student.course.download.updateAvailable')
          : t('student.course.download.done', { count: s.lessonCount });
      default:
        return t('student.course.download.none');
    }
  });
  protected readonly paywallContent = computed<PaywallContent | null>(() => {
    const locale = this.i18n.currentLocale();
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t(k, p);
    const only = this.paywallPlanId();
    const rows = paywallRows(
      this.plansForCourse(),
      only ? [only] : null,
      (price) =>
        formatPrice(
          {
            currency: price.currency,
            amountCents: price.amountCents,
            period: price.period,
            maxInstallments: price.maxInstallments,
          },
          locale,
        ),
      t,
    );
    if (rows.length === 0) return null;
    return {
      title: t('student.course.paywall.title'),
      subtitle: t('student.course.paywall.subtitle', {
        count: this.paidCount(),
      }),
      perks: [
        t('student.lesson.paywall.perk1'),
        t('student.lesson.paywall.perk2'),
        t('student.lesson.paywall.perk3'),
      ],
      plans: rows,
      footnote: t('student.lesson.paywall.footnote'),
    };
  });

  constructor() {
    void this.downloads.hydrate();
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const slug = pm.get('slug');
      if (slug) void this.load(slug);
    });
  }

  protected reload(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) void this.load(slug);
  }

  private async load(slug: string): Promise<void> {
    this.loading.set(true);
    this.notFound.set(false);
    this.errorKey.set(null);
    this.fromCache.set(false);
    this.completedIds.set(new Set());
    this.plansForCourse.set([]);
    this.activePlanIds.set(new Set());
    this.enrollment.set(null);
    this.certificate.set(null);
    try {
      if (!this.network.online()) throw new Error('offline');
      const detail = await this.coursesClient.detail(slug);
      this.course.set(detail);
      this.courseId.set(detail.id);
      await this.loadSideData(detail);
      saveCourse(detail, this.completedIds());
    } catch (err) {
      const kind =
        err instanceof Error && err.message === 'offline'
          ? 'network'
          : classifyLoadError(err);
      const cached =
        kind === 'network' || kind === 'error' ? loadCourse(slug) : null;
      if (cached) {
        this.course.set(cached.detail);
        this.courseId.set(cached.detail.id);
        this.completedIds.set(new Set(cached.completedIds));
        this.fromCache.set(true);
      } else if (kind === 'notFound') {
        this.notFound.set(true);
        this.course.set(null);
      } else {
        this.course.set(null);
        this.errorKey.set(
          kind === 'network'
            ? 'studentPlatform.errors.network'
            : errorMessageKey(err),
        );
      }
    } finally {
      this.loading.set(false);
    }
    void this.refreshDownloadedLessons();
  }

  /** Progress, plans, subscription, enrollment and certificate. */
  private async loadSideData(detail: CourseDetail): Promise<void> {
    const [progress, plans, mine, enrollments, certs] =
      await Promise.allSettled([
        this.progressClient.forCourse(detail.id),
        this.plansClient.list({ courseId: detail.id }),
        this.billing.mySubscription(),
        this.enrollments.mine(),
        this.certs.listMine(),
      ]);
    if (progress.status === 'fulfilled') {
      this.completedIds.set(
        new Set(progress.value.items.map((i) => i.lessonId)),
      );
    }
    if (plans.status === 'fulfilled')
      this.plansForCourse.set(plans.value.items.filter((p) => p.isActive));
    if (mine.status === 'fulfilled')
      this.activePlanIds.set(new Set(mine.value.activePlanIds));
    if (enrollments.status === 'fulfilled') {
      this.enrollment.set(
        enrollments.value.find((e) => e.courseId === detail.id) ?? null,
      );
    }
    if (certs.status === 'fulfilled') {
      const cert = certs.value.find((c) => c.courseId === detail.id);
      if (cert) this.certificate.set({ serial: cert.serial });
    }
  }

  private async refreshDownloadedLessons(): Promise<void> {
    const ids = this.allLessons().map((l) => l.id);
    const found = await Promise.all(
      ids.map((id) =>
        this.downloads
          .getDownloadedLesson(id)
          .then((x) => (x ? id : null))
          .catch(() => null),
      ),
    );
    this.downloadedLessons.set(new Set(found.filter((x): x is string => !!x)));
  }

  // ─── Enrollment ───────────────────────────────────────────────────────

  protected async enroll(): Promise<void> {
    const c = this.course();
    if (!c) return;
    this.enrolling.set(true);
    try {
      await this.enrollments.enroll(c.id);
      const mine = await this.enrollments.mine();
      this.enrollment.set(mine.find((e) => e.courseId === c.id) ?? null);
      this.downloads.onEnrolled(c.id);
      this.toast.show({ message: 'student.course.enrolled', kind: 'success' });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.enrolling.set(false);
    }
  }

  protected async unenroll(): Promise<void> {
    const c = this.course();
    if (!c) return;
    this.enrolling.set(true);
    try {
      await this.enrollments.unenroll(c.id);
      this.enrollment.set(null);
      this.toast.show({ message: 'student.course.unenrolled', kind: 'info' });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.enrolling.set(false);
    }
  }

  // ─── Plans ────────────────────────────────────────────────────────────

  protected openPaywall(planId: string | null = null): void {
    this.paywallPlanId.set(planId);
    this.paywallOpen.set(true);
    this.telemetry.track('plans_view', { source: 'paywall' });
  }

  protected choosePrice(priceId: string): void {
    this.paywallOpen.set(false);
    void this.router.navigate(['/subscription'], {
      queryParams: { price: priceId },
    });
  }

  protected cheapest(plan: Plan): string | null {
    const prices = plan.prices.filter((p) => p.isActive);
    const monthly = prices.find((p) => p.period === 'MONTHLY') ?? prices[0];
    if (!monthly) return null;
    return formatPrice(
      {
        currency: monthly.currency,
        amountCents: monthly.amountCents,
        period: monthly.period,
        maxInstallments: null,
      },
      this.i18n.currentLocale(),
      { installments: false },
    );
  }

  // ─── Certificate ──────────────────────────────────────────────────────

  protected async claimCertificate(): Promise<void> {
    const c = this.course();
    if (!c) return;
    this.claiming.set(true);
    try {
      const cert = await this.certs.claim(c.id);
      this.certificate.set({ serial: cert.serial });
      this.telemetry.track('certificate_claimed', {
        courseId: c.id,
        isCapstone: cert.isCapstone,
      });
      this.toast.show({
        message: 'student.course.certClaimed',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.claiming.set(false);
    }
  }

  // ─── Downloads ────────────────────────────────────────────────────────

  protected async downloadCourse(): Promise<void> {
    const c = this.course();
    if (!c) return;
    try {
      await this.downloads.downloadCourse(c.id);
    } catch (err) {
      this.toast.error(err);
    }
    await this.refreshDownloadedLessons();
  }

  protected pauseDownload(): void {
    this.downloads.pause(this.courseId());
  }

  protected async resumeDownload(): Promise<void> {
    try {
      await this.downloads.resume(this.courseId());
    } catch (err) {
      this.toast.error(err);
    }
    await this.refreshDownloadedLessons();
  }

  protected cancelDownload(): void {
    this.downloads.cancel(this.courseId());
    void this.refreshDownloadedLessons();
  }

  protected async updateDownload(): Promise<void> {
    try {
      await this.downloads.updateCourse(this.courseId());
      this.toast.show({
        message: 'student.course.download.updated',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    }
    await this.refreshDownloadedLessons();
  }

  protected async removeDownload(): Promise<void> {
    try {
      await this.downloads.removeCourse(this.courseId());
    } catch (err) {
      this.toast.error(err);
    }
    await this.refreshDownloadedLessons();
  }

  protected async downloadModule(moduleId: string): Promise<void> {
    try {
      await this.downloads.downloadModule(this.courseId(), moduleId);
    } catch (err) {
      this.toast.error(err);
    }
    await this.refreshDownloadedLessons();
  }

  protected async downloadLesson(lessonId: string): Promise<void> {
    this.lessonBusy.set(lessonId);
    try {
      await this.downloads.downloadLesson(lessonId);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.lessonBusy.set(null);
    }
    await this.refreshDownloadedLessons();
  }

  protected moduleDownloaded(lessons: readonly CourseLessonSummary[]): boolean {
    const saved = this.downloadedLessons();
    const eligible = lessons.filter((l) => this.canDownloadLesson(l));
    return eligible.length > 0 && eligible.every((l) => saved.has(l.id));
  }

  /** Paid lessons without access can't be downloaded (the API answers 402). */
  protected canDownloadLesson(l: CourseLessonSummary): boolean {
    return l.isFree || this.hasAccess();
  }

  // ─── View helpers ─────────────────────────────────────────────────────

  protected duration(minutes: number): string {
    if (minutes < 60) return this.i18n.t('ui.duration.minutes', { m: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m
      ? this.i18n.t('ui.duration.hoursMinutes', { h, m })
      : this.i18n.t('ui.duration.hours', { h });
  }

  protected lessonType(t: LessonType): LessonItemType {
    return LESSON_TYPE_MAP[t];
  }

  protected lessonStatus(l: CourseLessonSummary): LessonItemStatus {
    if (this.completedIds().has(l.id)) return 'completed';
    return 'not-started';
  }

  protected lessonSubtitle(
    l: CourseLessonSummary,
    index: number,
    total: number,
  ): string {
    const pos = this.i18n.t('student.lesson.position', {
      index: index + 1,
      total,
    });
    if (!l.isFree && !this.hasAccess())
      return `${pos} · ${this.i18n.t('student.course.premiumLesson')}`;
    return pos;
  }
}
