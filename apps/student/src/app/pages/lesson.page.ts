import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
  IonFooter,
} from '@ionic/angular/standalone';
import {
  CoursesClient,
  LessonsClient,
  PlansClient,
  ProgressClient,
  type CompleteLessonResponse,
  type Lesson,
  type Plan,
  type QuizAttemptResult,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';
import {
  LessonBlockRenderer,
  LessonRefSlot,
  type LessonQuizResult,
} from '@codify/ui-bootstrap';
import type { LessonDoc, QuizAnswers } from '@codify/lesson-schema';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  CoinBadge,
  EmptyState,
  ErrorState,
  Icon,
  OfflineState,
  PaywallSheet,
  XpBadge,
  type PaywallContent,
} from '@codify/ui-ionic';
import {
  OfflineSyncService,
  type QuizSubmitOutcome,
} from '../offline/offline-sync.service.js';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import {
  AppToastService,
  errorMessageKey,
} from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  LessonExerciseComponent,
  type RunnerCompletion,
} from '../components/lesson-exercise.component.js';
import { LessonAiPromptComponent } from '../components/lesson-ai-prompt.component.js';
import { LessonScenarioComponent } from '../components/lesson-scenario.component.js';
import { rewardPayload } from '../components/reward-grant.js';
import { runnerError } from '../components/runner-errors.js';
import { paywallRows } from './shared/plan-view.js';
import {
  allQuizzesAnswered,
  classifyLoadError,
  hasReadableContent,
  hasRefBlocks,
  isInteractiveType,
  lessonFromBundle,
  quizIds,
  requiredPlansFrom,
  toQuizView,
  type LessonViewState,
  type RequiredPlan,
} from './lesson/lesson-state.js';

interface Completion {
  xp: number;
  coins: number;
  queued: boolean;
}

interface Neighbour {
  id: string;
  title: string;
}

/**
 * Lesson player (docs/05 §4, docs/06). Renders the `LessonDoc` with the
 * shared `LessonBlockRenderer`; quiz blocks are answered inline and graded
 * by the server through `OfflineSyncService.submitQuiz` (queued + checked
 * locally when offline). Exercise / AI-prompt / scenario / capstone lessons
 * mount their runner by lesson type, or wherever the doc has a ref block.
 *
 * Distinct states: 402 → paywall with the plans that unlock the lesson;
 * 404 → not found; offline and not downloaded → offline state; anything
 * else → retryable error. Rewards play once through `RewardOrchestrator`
 * with the server's canonical totals (the toast shows the multipliers).
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
    IonFooter,
    AppButton,
    AppCard,
    AppSkeleton,
    CoinBadge,
    EmptyState,
    ErrorState,
    Icon,
    OfflineState,
    PaywallSheet,
    XpBadge,
    LessonBlockRenderer,
    LessonRefSlot,
    LessonExerciseComponent,
    LessonAiPromptComponent,
    LessonScenarioComponent,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            [defaultHref]="backHref()"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{
          lesson()?.title ?? ('student.lesson.title' | translate)
        }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="lp" [attr.data-state]="state()" data-testid="lesson-page">
        @switch (state()) {
          @case ('loading') {
            <div class="lp__skel" aria-busy="true">
              <cdf-app-skeleton shape="text" />
              <cdf-app-skeleton shape="text" />
              <cdf-app-skeleton shape="rect" [height]="160" />
            </div>
          }
          @case ('paywall') {
            <cdf-app-card
              padding="spacious"
              class="lp__paywall"
              data-testid="lesson-paywall"
            >
              <cdf-icon name="shield" size="lg" />
              <h1>{{ 'student.lesson.paywall.title' | translate }}</h1>
              <p>{{ 'student.lesson.paywall.body' | translate }}</p>
              @if (requiredPlans().length > 0) {
                <ul class="lp__plans" data-testid="lesson-required-plans">
                  @for (p of requiredPlans(); track p.id) {
                    <li [attr.data-plan-id]="p.id">{{ p.name }}</li>
                  }
                </ul>
              }
              <div class="lp__actions">
                <cdf-app-button
                  kind="primary"
                  (buttonClick)="openPaywall()"
                  data-testid="paywall-cta"
                >
                  {{ 'student.lesson.paywall.cta' | translate }}
                </cdf-app-button>
                <cdf-app-button kind="ghost" [routerLink]="backHref()">
                  {{ 'student.lesson.backToCourse' | translate }}
                </cdf-app-button>
              </div>
            </cdf-app-card>
          }
          @case ('notFound') {
            <cdf-empty-state
              icon="school"
              data-testid="lesson-not-found"
              [title]="'student.lesson.notFound.title' | translate"
              [description]="'student.lesson.notFound.body' | translate"
            >
              <cdf-app-button kind="primary" routerLink="/catalog">{{
                'student.myCourses.browse' | translate
              }}</cdf-app-button>
            </cdf-empty-state>
          }
          @case ('offlineMissing') {
            <cdf-offline-state
              data-testid="lesson-offline"
              [title]="'student.lesson.offline.title' | translate"
              [description]="'student.lesson.offline.body' | translate"
              [hasDownloads]="downloads.downloads().length > 0"
              [queued]="sync.pendingCount()"
              (retry)="reload()"
              (openDownloads)="openDownloads()"
            />
          }
          @case ('error') {
            <cdf-error-state
              data-testid="lesson-error"
              [title]="'student.lesson.error.title' | translate"
              [description]="
                errorKey() ?? 'studentPlatform.errors.unknown' | translate
              "
              (retry)="reload()"
            />
          }
          @case ('ready') {
            @if (lesson(); as l) {
              <article
                class="lp__article"
                data-testid="lesson-article"
                [attr.data-lesson-type]="l.type"
              >
                @if (fromCache()) {
                  <p class="lp__offline" data-testid="offline-read">
                    <cdf-icon name="cloud-offline" size="xs" />
                    {{ 'student.lesson.readingOffline' | translate }}
                  </p>
                }
                <header class="lp__head">
                  @if (position(); as pos) {
                    <p class="lp__eyebrow">
                      {{ 'student.lesson.position' | translate: pos }}
                    </p>
                  }
                  <h1>{{ l.title }}</h1>
                  <p class="lp__meta">
                    @if (l.estimatedMinutes) {
                      <span
                        ><cdf-icon name="hourglass" size="xs" />
                        {{
                          'ui.duration.minutes'
                            | translate: { m: l.estimatedMinutes }
                        }}</span
                      >
                    }
                    <cdf-xp-badge [value]="l.baseXp" size="sm" />
                    <cdf-coin-badge [value]="l.baseCoins" size="sm" />
                  </p>
                </header>

                @if (showDoc()) {
                  <cdf-lesson-block-renderer
                    [doc]="doc()"
                    [(quizAnswers)]="answers"
                    [quizResult]="quizResult()"
                    [interactionDisabled]="submittingQuiz()"
                  >
                    <ng-template cdfLessonRef let-ref>
                      @switch (ref.kind) {
                        @case ('exercise') {
                          <cdf-lesson-exercise
                            [lessonId]="l.id"
                            (completed)="onRunnerCompleted($event)"
                            (paywall)="onRunnerPaywall($event)"
                          />
                        }
                        @case ('aiPrompt') {
                          <cdf-lesson-ai-prompt
                            [lessonId]="l.id"
                            (completed)="onRunnerCompleted($event)"
                            (paywall)="onRunnerPaywall($event)"
                          />
                        }
                        @case ('scenario') {
                          <cdf-lesson-scenario
                            [lessonId]="l.id"
                            (completed)="onRunnerCompleted($event)"
                            (paywall)="onRunnerPaywall($event)"
                          />
                        }
                      }
                    </ng-template>
                  </cdf-lesson-block-renderer>
                }

                @if (runnerByType(); as kind) {
                  <section
                    class="lp__runner"
                    [attr.aria-label]="
                      'student.lesson.runnerLabel.' + kind | translate
                    "
                  >
                    @switch (kind) {
                      @case ('exercise') {
                        <cdf-lesson-exercise
                          [lessonId]="l.id"
                          (completed)="onRunnerCompleted($event)"
                          (paywall)="onRunnerPaywall($event)"
                        />
                      }
                      @case ('aiPrompt') {
                        <cdf-lesson-ai-prompt
                          [lessonId]="l.id"
                          (completed)="onRunnerCompleted($event)"
                          (paywall)="onRunnerPaywall($event)"
                        />
                      }
                      @case ('scenario') {
                        <cdf-lesson-scenario
                          [lessonId]="l.id"
                          (completed)="onRunnerCompleted($event)"
                          (paywall)="onRunnerPaywall($event)"
                        />
                      }
                    }
                  </section>
                }

                @if (quizFeedback(); as fb) {
                  <div
                    class="lp__quiz-result"
                    role="status"
                    data-testid="quiz-result"
                    [attr.data-passed]="fb.passed"
                  >
                    <cdf-icon
                      [name]="fb.passed ? 'check-circle' : 'x-circle'"
                      size="md"
                    />
                    <span>{{ fb.key | translate: fb.params }}</span>
                  </div>
                }
              </article>
            }
          }
        }
      </div>

      @if (paywallContent(); as pc) {
        <cdf-paywall-sheet
          reason="lesson-locked"
          [open]="paywallOpen()"
          [content]="pc"
          (dismissed)="paywallOpen.set(false)"
          (selected)="choosePlan($event)"
        />
      }
    </ion-content>

    @if (state() === 'ready' && lesson()) {
      <ion-footer>
        <ion-toolbar>
          <div class="lp__cta">
            @if (completion(); as c) {
              <div
                class="lp__done"
                data-testid="lesson-completed"
                [attr.data-queued]="c.queued"
              >
                <cdf-icon name="check-circle" size="md" />
                <span>{{
                  (c.queued
                    ? 'student.lesson.savedOffline'
                    : 'student.lesson.completed'
                  ) | translate
                }}</span>
                @if (c.xp) {
                  <cdf-xp-badge [value]="c.xp" size="sm" />
                }
                @if (c.coins) {
                  <cdf-coin-badge [value]="c.coins" size="sm" />
                }
              </div>
              @if (c.queued) {
                <small class="lp__hint">{{
                  'student.lesson.willSync' | translate
                }}</small>
              }
              @if (next(); as n) {
                <cdf-app-button
                  kind="primary"
                  [routerLink]="['/lessons', n.id]"
                  data-testid="next-lesson"
                >
                  {{ 'student.lesson.next' | translate }}
                  <cdf-icon name="arrow-forward" size="sm" />
                </cdf-app-button>
              } @else {
                <cdf-app-button kind="secondary" [routerLink]="backHref()">
                  {{ 'student.lesson.backToCourse' | translate }}
                </cdf-app-button>
              }
            } @else if (isQuiz()) {
              @if (quizResult() && !quizResult()!.passed) {
                <cdf-app-button
                  kind="primary"
                  (buttonClick)="retryQuiz()"
                  data-testid="quiz-retry"
                >
                  {{ 'student.lesson.quiz.retry' | translate }}
                </cdf-app-button>
              } @else if (!quizQueued()) {
                <cdf-app-button
                  kind="primary"
                  [disabled]="!canSubmitQuiz()"
                  [loading]="submittingQuiz()"
                  (buttonClick)="submitQuiz($event)"
                  data-testid="quiz-submit"
                >
                  {{ 'student.lesson.quiz.submit' | translate }}
                </cdf-app-button>
                @if (!canSubmitQuiz()) {
                  <small class="lp__hint">{{
                    'student.lesson.quiz.answerAll' | translate
                  }}</small>
                }
              }
            } @else if (!interactive()) {
              <cdf-app-button
                kind="primary"
                [loading]="completing()"
                data-testid="lesson-complete-btn"
                (buttonClick)="completeLesson($event)"
              >
                {{ 'student.lesson.markComplete' | translate }}
              </cdf-app-button>
            } @else {
              <small class="lp__hint">{{
                'student.lesson.finishRunner' | translate
              }}</small>
            }
          </div>
        </ion-toolbar>
      </ion-footer>
    }
  `,
  styles: [
    `
      .lp {
        max-width: 720px;
        margin: 0 auto;
      }
      .lp__skel {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .lp__head {
        margin-bottom: var(--cdf-space-4);
      }
      .lp__head h1 {
        margin: 0 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-2xl);
      }
      .lp__eyebrow {
        margin: 0;
        font-size: var(--cdf-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .lp__meta {
        margin: 0;
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .lp__offline {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
        margin: 0 0 var(--cdf-space-2);
      }
      .lp__runner {
        margin-top: var(--cdf-space-4);
      }
      .lp__quiz-result {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        margin-top: var(--cdf-space-3);
        padding: var(--cdf-space-3);
        border-radius: 12px;
        font-weight: 600;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.04));
      }
      .lp__quiz-result[data-passed='true'] {
        color: var(--cdf-color-success);
      }
      .lp__quiz-result[data-passed='false'] {
        color: var(--cdf-color-danger);
      }
      .lp__paywall {
        display: block;
        max-width: 520px;
        margin: var(--cdf-space-6) auto;
        text-align: center;
      }
      .lp__paywall h1 {
        font-size: var(--cdf-font-size-xl);
        margin: var(--cdf-space-2) 0 var(--cdf-space-1);
      }
      .lp__plans {
        list-style: none;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: center;
      }
      .lp__plans li {
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--cdf-color-primary);
        color: var(--cdf-color-primary);
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
      }
      .lp__actions {
        display: flex;
        gap: var(--cdf-space-2);
        justify-content: center;
        flex-wrap: wrap;
        margin-top: var(--cdf-space-3);
      }
      .lp__cta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2);
      }
      .lp__done {
        display: inline-flex;
        align-items: center;
        gap: var(--cdf-space-2);
        font-weight: 600;
        color: var(--cdf-color-success);
      }
      .lp__done[data-queued='true'] {
        color: var(--cdf-color-warning);
      }
      .lp__hint {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-xs);
      }
    `,
  ],
})
export class LessonPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly coursesClient = inject(CoursesClient);
  private readonly progressClient = inject(ProgressClient);
  private readonly plansClient = inject(PlansClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);
  protected readonly sync = inject(OfflineSyncService);
  protected readonly downloads = inject(DownloadService);

  protected readonly state = signal<LessonViewState>('loading');
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly fromCache = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly requiredPlans = signal<RequiredPlan[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly paywallOpen = signal(false);
  protected readonly completion = signal<Completion | null>(null);
  protected readonly completing = signal(false);
  protected readonly answers = signal<QuizAnswers>({});
  protected readonly quizResult = signal<LessonQuizResult | null>(null);
  protected readonly quizQueued = signal(false);
  protected readonly submittingQuiz = signal(false);
  protected readonly attempts = signal(0);
  protected readonly next = signal<Neighbour | null>(null);
  protected readonly position = signal<{ index: number; total: number } | null>(
    null,
  );
  private readonly courseSlug = signal<string | null>(null);
  private openedAt = Date.now();
  private loadSeq = 0;

  protected readonly doc = computed<LessonDoc | null>(
    () => (this.lesson()?.contentJson as LessonDoc | null) ?? null,
  );
  protected readonly isQuiz = computed(() => quizIds(this.doc()).length > 0);
  protected readonly interactive = computed(
    () => isInteractiveType(this.lesson()?.type) || hasRefBlocks(this.doc()),
  );
  protected readonly showDoc = computed(() => hasReadableContent(this.doc()));
  /** Runner to mount by lesson type when the doc has no ref block for it. */
  protected readonly runnerByType = computed<
    'exercise' | 'aiPrompt' | 'scenario' | null
  >(() => {
    const l = this.lesson();
    if (!l || hasRefBlocks(this.doc())) return null;
    switch (l.type) {
      case 'EXERCISE':
        return 'exercise';
      case 'AI_PROMPT':
      case 'CAPSTONE':
        return 'aiPrompt';
      case 'SCENARIO':
        return 'scenario';
      default:
        return null;
    }
  });
  protected readonly canSubmitQuiz = computed(
    () =>
      !this.submittingQuiz() && allQuizzesAnswered(this.doc(), this.answers()),
  );
  protected readonly quizFeedback = computed<{
    passed: boolean;
    key: string;
    params: Record<string, unknown>;
  } | null>(() => {
    const r = this.quizResult();
    if (r) {
      return {
        passed: r.passed,
        key: r.passed
          ? 'student.lesson.quiz.passed'
          : 'student.lesson.quiz.failed',
        params: { score: Math.round(r.scorePct) },
      };
    }
    if (this.quizQueued()) {
      return { passed: true, key: 'student.lesson.quiz.queued', params: {} };
    }
    return null;
  });
  protected readonly backHref = computed(() =>
    this.courseSlug() ? `/courses/${this.courseSlug()}` : '/catalog',
  );
  protected readonly paywallContent = computed<PaywallContent | null>(() => {
    const locale = this.i18n.currentLocale();
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t(k, p);
    const required = this.requiredPlans().map((p) => p.id);
    const rows = paywallRows(
      this.plans(),
      required,
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
      title: t('student.lesson.paywall.sheetTitle'),
      subtitle: t('student.lesson.paywall.sheetSubtitle'),
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
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const id = pm.get('id');
      if (id) void this.load(id);
    });

    // A queued completion / quiz attempt for this lesson synced: reflect the
    // canonical result (the sync service reconciled the counters).
    effect(() => {
      const r = this.sync.lastReconciled.lessonComplete();
      const l = untracked(() => this.lesson());
      if (!r || !l || r.lessonId !== l.id) return;
      untracked(() =>
        this.completion.set({
          xp: r.response.progress.xpAwarded,
          coins: r.response.progress.coinsAwarded,
          queued: false,
        }),
      );
    });
    effect(() => {
      const r = this.sync.lastReconciled.quizAttempt();
      const l = untracked(() => this.lesson());
      if (!r || !l || r.lessonId !== l.id) return;
      untracked(() => this.applyQuizResult(r.result, null));
    });

    // A background sync of a queued completion for this lesson hit 402.
    effect(() => {
      const pw = this.sync.paywall();
      const l = untracked(() => this.lesson());
      if (!pw || !l || pw.lessonId !== l.id) return;
      untracked(() => this.showPaywall(l.id, null));
    });

    inject(DestroyRef).onDestroy(() => this.trackAbandon());
  }

  protected reload(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) void this.load(id);
  }

  private reset(): void {
    this.state.set('loading');
    this.lesson.set(null);
    this.fromCache.set(false);
    this.errorKey.set(null);
    this.requiredPlans.set([]);
    this.paywallOpen.set(false);
    this.completion.set(null);
    this.answers.set({});
    this.quizResult.set(null);
    this.quizQueued.set(false);
    this.attempts.set(0);
    this.next.set(null);
    this.position.set(null);
    this.courseSlug.set(null);
    this.openedAt = Date.now();
  }

  private async load(id: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.reset();

    if (!this.network.online()) {
      await this.loadOffline(id, seq);
      return;
    }
    try {
      const lesson = await this.lessonsClient.detail(id);
      if (seq !== this.loadSeq) return;
      this.show(lesson, false);
      void this.loadContext(lesson, seq);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      switch (classifyLoadError(err)) {
        case 'paywall':
          this.showPaywall(id, err);
          break;
        case 'notFound':
          this.state.set('notFound');
          break;
        case 'network':
          await this.loadOffline(id, seq);
          break;
        default:
          this.errorKey.set(errorMessageKey(err));
          this.state.set('error');
      }
    }
  }

  /** Read from the download cache (or the offline bundle) when offline. */
  private async loadOffline(id: string, seq: number): Promise<void> {
    let bundle = null;
    try {
      bundle = await this.downloads.getLessonBundle(id);
    } catch {
      bundle = null;
    }
    if (seq !== this.loadSeq) return;
    if (!bundle) {
      this.state.set('offlineMissing');
      return;
    }
    this.show(lessonFromBundle(bundle), true);
  }

  private show(lesson: Lesson, fromCache: boolean): void {
    this.lesson.set(lesson);
    this.fromCache.set(fromCache);
    this.state.set('ready');
    void this.downloads.markRead(lesson.courseId);
    this.telemetry.track('lesson_open', {
      lessonId: lesson.id,
      courseId: lesson.courseId,
      lessonType: lesson.type,
      fromOffline: fromCache,
    });
  }

  /** Already-completed flag, module position and the next lesson. */
  private async loadContext(lesson: Lesson, seq: number): Promise<void> {
    const [progress, course] = await Promise.allSettled([
      this.progressClient.forCourse(lesson.courseId),
      this.coursesClient.detail(lesson.courseId),
    ]);
    if (seq !== this.loadSeq) return;
    if (progress.status === 'fulfilled') {
      const item = progress.value.items.find((i) => i.lessonId === lesson.id);
      if (item && !this.completion()) {
        this.completion.set({
          xp: item.xpAwarded,
          coins: item.coinsAwarded,
          queued: false,
        });
      }
    }
    if (course.status === 'fulfilled') {
      this.courseSlug.set(course.value.slug);
      const all = course.value.modules.flatMap((m) => m.lessons);
      const idx = all.findIndex((l) => l.id === lesson.id);
      const mod = course.value.modules.find((m) =>
        m.lessons.some((l) => l.id === lesson.id),
      );
      if (mod) {
        const i = mod.lessons.findIndex((l) => l.id === lesson.id);
        this.position.set({ index: i + 1, total: mod.lessons.length });
      }
      const n = idx >= 0 ? all[idx + 1] : undefined;
      this.next.set(n ? { id: n.id, title: n.title } : null);
    }
  }

  private showPaywall(lessonId: string, err: unknown): void {
    this.requiredPlans.set(requiredPlansFrom(err));
    this.state.set('paywall');
    this.telemetry.track('paywall_view', {
      lessonId,
      courseId: this.lesson()?.courseId ?? null,
    });
    void this.loadPlans();
  }

  private async loadPlans(): Promise<void> {
    try {
      this.plans.set((await this.plansClient.list()).items);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected openPaywall(): void {
    this.paywallOpen.set(true);
    this.telemetry.track('plans_view', { source: 'paywall' });
    if (!this.paywallContent()) void this.router.navigateByUrl('/subscription');
  }

  protected choosePlan(priceId: string): void {
    this.paywallOpen.set(false);
    void this.router.navigate(['/subscription'], {
      queryParams: { price: priceId },
    });
  }

  protected openDownloads(): void {
    void this.router.navigateByUrl('/downloads');
  }

  // ─── Quiz ──────────────────────────────────────────────────────────────

  protected async submitQuiz(ev?: MouseEvent): Promise<void> {
    const l = this.lesson();
    if (!l || !this.canSubmitQuiz()) return;
    const sourceEl = (ev?.currentTarget as HTMLElement | null) ?? null;
    this.submittingQuiz.set(true);
    try {
      const outcome: QuizSubmitOutcome = await this.sync.submitQuiz(
        l.id,
        this.answers(),
      );
      this.attempts.update((n) => n + 1);
      if (outcome.status === 'graded') {
        this.applyQuizResult(outcome.result, sourceEl);
      } else {
        this.quizQueued.set(true);
        this.completion.set(
          outcome.localCheck?.allCorrect
            ? { xp: l.baseXp, coins: l.baseCoins, queued: true }
            : null,
        );
      }
    } catch (err) {
      if (classifyLoadError(err) === 'paywall') {
        this.showPaywall(l.id, err);
      } else {
        const e = runnerError(err);
        this.toast.show({ message: e.key, params: e.params, kind: 'warning' });
      }
    } finally {
      this.submittingQuiz.set(false);
    }
  }

  private applyQuizResult(
    result: QuizAttemptResult,
    sourceEl: HTMLElement | null,
  ): void {
    this.quizQueued.set(false);
    this.quizResult.set(toQuizView(result));
    if (!result.passed || !result.completion) return;
    const c = result.completion;
    this.completion.set({
      xp: c.progress.xpAwarded,
      coins: c.progress.coinsAwarded,
      queued: false,
    });
    if (c.reward && !c.alreadyCompleted) {
      void this.orchestrator.grant(
        rewardPayload('quizPass', c.reward, c.badgesUnlocked, sourceEl),
      );
    }
    this.trackComplete(c.alreadyCompleted);
  }

  protected retryQuiz(): void {
    this.quizResult.set(null);
    this.answers.set({});
  }

  // ─── Reading lessons ───────────────────────────────────────────────────

  protected async completeLesson(ev?: MouseEvent): Promise<void> {
    const l = this.lesson();
    if (!l || this.completing()) return;
    const sourceEl = (ev?.currentTarget as HTMLElement | null) ?? null;
    this.completing.set(true);
    try {
      const outcome = await this.sync.completeLesson(l.id, { title: l.title });
      switch (outcome.status) {
        case 'synced':
          this.applyCompletion(outcome.response, sourceEl);
          this.trackComplete(false);
          break;
        case 'conflict':
          this.completion.set({
            xp: outcome.response.progress.xpAwarded,
            coins: outcome.response.progress.coinsAwarded,
            queued: false,
          });
          this.trackComplete(true);
          break;
        case 'queued':
          this.completion.set({
            xp: l.baseXp,
            coins: l.baseCoins,
            queued: true,
          });
          break;
        case 'paywall':
          this.showPaywall(l.id, outcome.error);
          break;
        case 'rejected':
          this.toast.show({ message: outcome.messageKey, kind: 'error' });
          break;
      }
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.completing.set(false);
    }
  }

  private applyCompletion(
    res: CompleteLessonResponse,
    sourceEl: HTMLElement | null,
  ): void {
    this.completion.set({
      xp: res.progress.xpAwarded,
      coins: res.progress.coinsAwarded,
      queued: false,
    });
    if (res.reward) {
      void this.orchestrator.grant(
        rewardPayload(
          'lessonComplete',
          res.reward,
          res.badgesUnlocked,
          sourceEl,
        ),
      );
    }
  }

  // ─── Runners ───────────────────────────────────────────────────────────

  /** The runner already played the reward; reflect the completed state. */
  protected onRunnerCompleted(r: RunnerCompletion): void {
    if (this.completion()) return;
    this.completion.set({ xp: r.xp, coins: r.coins, queued: false });
    this.trackComplete(false);
  }

  protected onRunnerPaywall(err: unknown): void {
    const l = this.lesson();
    if (l) this.showPaywall(l.id, err);
  }

  private trackComplete(alreadyCompleted: boolean): void {
    const l = this.lesson();
    if (!l) return;
    this.telemetry.track('lesson_complete', {
      lessonId: l.id,
      courseId: l.courseId,
      lessonType: l.type,
      durationMs: Date.now() - this.openedAt,
      alreadyCompleted,
    });
  }

  private trackAbandon(): void {
    const l = this.lesson();
    if (!l || this.completion() || this.state() !== 'ready') return;
    const ids = quizIds(this.doc());
    const answered = ids.filter(
      (id) => (this.answers()[id]?.length ?? 0) > 0,
    ).length;
    this.telemetry.track('lesson_abandon', {
      lessonId: l.id,
      lessonType: l.type,
      durationMs: Date.now() - this.openedAt,
      progressPct: ids.length ? Math.round((answered / ids.length) * 100) : 0,
    });
  }
}
