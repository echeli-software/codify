import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  MasteryClient,
  type ReviewCard,
  type ReviewResult,
} from '@codify/api-client';
import type { LessonDoc, QuizAnswers } from '@codify/lesson-schema';
import { LessonBlockRenderer } from '@codify/ui-bootstrap';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  EmptyState,
  ErrorState,
  Icon,
} from '@codify/ui-ionic';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { OfflineGate } from '../platform/offline-gate.component.js';
import {
  AppToastService,
  errorMessageKey,
} from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { allQuizzesAnswered } from './lesson/lesson-state.js';
import {
  REVIEW_BOXES,
  reviewOutcome,
  toReviewQuizView,
} from './review/review-session.js';

/**
 * Review session (docs/10 §7 spaced-repetition mastery checks): the due
 * cards one at a time — the lesson's quiz questions in the shared lesson
 * renderer, "Check" grades them on the server, the result shows the new
 * Leitner box and the topic's mastery, "Next" moves on. Online only.
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
    LessonBlockRenderer,
    AppButton,
    AppCard,
    AppSkeleton,
    EmptyState,
    ErrorState,
    Icon,
    OfflineGate,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/skills"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{ 'student.review.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="rv">
        <cdf-offline-gate capability="social">
          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="280" />
          } @else if (errorKey(); as e) {
            <cdf-error-state [description]="e | translate" (retry)="load()" />
          } @else if (card(); as c) {
            <p class="rv__progress" data-testid="review-progress">
              {{
                'student.review.progress'
                  | translate: { n: index() + 1, total: total() }
              }}
            </p>
            <cdf-app-card padding="normal">
              <article
                class="rv__card"
                data-testid="review-card"
                [attr.data-lesson]="c.lessonId"
                aria-labelledby="rv-lesson"
              >
                <header class="rv__head">
                  <p class="rv__muted">{{ c.courseTitle ?? c.courseSlug }}</p>
                  <h1 id="rv-lesson">
                    {{ c.lessonTitle ?? ('student.review.lesson' | translate) }}
                  </h1>
                  <div
                    class="rv__boxes"
                    role="img"
                    [attr.aria-label]="
                      'student.review.box' | translate: { box: shownBox() }
                    "
                  >
                    @for (b of boxes; track b) {
                      <span
                        class="rv__box"
                        [class.rv__box--on]="b <= shownBox()"
                        aria-hidden="true"
                      ></span>
                    }
                    <span class="rv__muted" aria-hidden="true">{{
                      'student.review.box' | translate: { box: shownBox() }
                    }}</span>
                  </div>
                </header>

                <cdf-lesson-block-renderer
                  [doc]="doc()"
                  [(quizAnswers)]="answers"
                  [quizResult]="quizView()"
                  [interactionDisabled]="submitting() || !!result()"
                />

                @if (result(); as r) {
                  <div
                    class="rv__result"
                    role="status"
                    data-testid="review-result"
                    [attr.data-passed]="r.passed"
                  >
                    <cdf-icon
                      [name]="r.passed ? 'check-circle' : 'x-circle'"
                      size="md"
                    />
                    <div>
                      <strong>{{
                        outcome()!.key | translate: outcome()!.params
                      }}</strong>
                      @for (t of r.topics; track t.categoryId ?? 'other') {
                        <p class="rv__muted" data-testid="review-mastery">
                          {{
                            'student.review.mastery'
                              | translate
                                : {
                                    topic:
                                      t.name ??
                                      ('student.skills.other' | translate),
                                    level:
                                      ('student.skills.level.' + t.mastery
                                      | translate),
                                  }
                          }}
                        </p>
                      }
                    </div>
                  </div>
                }

                <div class="rv__actions">
                  @if (result()) {
                    <cdf-app-button
                      kind="primary"
                      (buttonClick)="next()"
                      data-testid="review-next"
                    >
                      {{
                        (index() + 1 < total()
                          ? 'student.review.next'
                          : 'student.review.finish'
                        ) | translate
                      }}
                    </cdf-app-button>
                  } @else {
                    <cdf-app-button
                      kind="primary"
                      [disabled]="!canSubmit()"
                      [loading]="submitting()"
                      (buttonClick)="submit()"
                      data-testid="review-submit"
                    >
                      {{ 'student.review.check' | translate }}
                    </cdf-app-button>
                    @if (!canSubmit() && !submitting()) {
                      <span class="rv__muted">{{
                        'student.review.answerAll' | translate
                      }}</span>
                    }
                  }
                </div>
              </article>
            </cdf-app-card>
          } @else {
            <cdf-empty-state
              icon="check-circle"
              data-testid="review-done"
              [title]="
                (reviewed()
                  ? 'student.review.doneTitle'
                  : 'student.review.noneTitle'
                ) | translate
              "
              [description]="
                reviewed()
                  ? ('student.review.doneBody'
                    | translate: { passed: passedCount(), total: reviewed() })
                  : ('student.review.noneBody' | translate)
              "
            />
            @if (nextDueAt(); as at) {
              <p class="rv__muted rv__center" data-testid="review-next-due">
                {{
                  'student.review.nextDue'
                    | translate: { when: (at | locale: 'relative') }
                }}
              </p>
            }
            <div class="rv__actions rv__center">
              @if (moreDue()) {
                <cdf-app-button kind="primary" (buttonClick)="load()">
                  {{ 'student.review.more' | translate }}
                </cdf-app-button>
              }
              <cdf-app-button kind="secondary" routerLink="/skills">
                {{ 'student.review.backToSkills' | translate }}
              </cdf-app-button>
            </div>
          }
        </cdf-offline-gate>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .rv {
        max-width: 760px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .rv__progress,
      .rv__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0;
      }
      .rv__head h1 {
        margin: 2px 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-lg);
      }
      .rv__boxes {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-bottom: var(--cdf-space-3);
      }
      .rv__box {
        width: 18px;
        height: 18px;
        border-radius: 5px;
        border: 2px solid var(--cdf-color-border);
      }
      .rv__box--on {
        background: var(--cdf-color-primary);
        border-color: var(--cdf-color-primary);
      }
      .rv__result {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        margin-top: var(--cdf-space-3);
        padding: var(--cdf-space-3);
        border-radius: 12px;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.04));
      }
      .rv__result[data-passed='true'] strong {
        color: var(--cdf-color-success);
      }
      .rv__result[data-passed='false'] strong {
        color: var(--cdf-color-danger);
      }
      .rv__result p {
        margin: 4px 0 0;
      }
      .rv__actions {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
        margin-top: var(--cdf-space-3);
      }
      .rv__center {
        justify-content: center;
        text-align: center;
      }
    `,
  ],
})
export class ReviewPage {
  private readonly client = inject(MasteryClient);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly boxes = REVIEW_BOXES;
  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly items = signal<ReviewCard[]>([]);
  protected readonly index = signal(0);
  protected readonly answers = signal<QuizAnswers>({});
  protected readonly result = signal<ReviewResult | null>(null);
  protected readonly submitting = signal(false);
  protected readonly nextDueAt = signal<string | null>(null);
  /** Cards still due after the last graded one (beyond this page). */
  private readonly dueLeft = signal(0);
  protected readonly reviewed = signal(0);
  protected readonly passedCount = signal(0);

  protected readonly total = computed(() => this.items().length);
  protected readonly card = computed(() => this.items()[this.index()] ?? null);
  protected readonly doc = computed(
    () => (this.card()?.doc ?? null) as LessonDoc | null,
  );
  protected readonly shownBox = computed(
    () => this.result()?.card.box ?? this.card()?.box ?? 1,
  );
  protected readonly quizView = computed(() => {
    const r = this.result();
    return r ? toReviewQuizView(r) : null;
  });
  protected readonly outcome = computed(() => {
    const r = this.result();
    return r ? reviewOutcome(r) : null;
  });
  protected readonly canSubmit = computed(
    () => !this.submitting() && allQuizzesAnswered(this.doc(), this.answers()),
  );
  protected readonly moreDue = computed(
    () => this.reviewed() > 0 && this.dueLeft() > 0,
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const q = await this.client.reviews();
      this.items.set(q.items);
      this.nextDueAt.set(q.nextDueAt);
      this.dueLeft.set(q.dueCount);
      this.index.set(0);
      this.reset();
    } catch (err) {
      this.errorKey.set(errorMessageKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const c = this.card();
    if (!c || !this.canSubmit()) return;
    this.submitting.set(true);
    try {
      const r = await this.client.submitReview(c.lessonId, this.answers());
      this.result.set(r);
      this.dueLeft.set(r.dueCount);
      this.reviewed.update((n) => n + 1);
      if (r.passed) this.passedCount.update((n) => n + 1);
      this.telemetry.track('review_completed', {
        lessonId: c.lessonId,
        passed: r.passed,
        scorePct: r.scorePct,
        box: r.card.box,
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.submitting.set(false);
    }
  }

  protected next(): void {
    this.index.update((i) => i + 1);
    this.reset();
    if (this.index() >= this.total()) void this.refreshSummary();
  }

  /** At the end: what is still due, and when the next card comes up. */
  private async refreshSummary(): Promise<void> {
    try {
      const q = await this.client.reviews(1);
      this.nextDueAt.set(q.nextDueAt);
      this.dueLeft.set(q.dueCount);
    } catch {
      /* the summary is informative only */
    }
  }

  private reset(): void {
    this.answers.set({});
    this.result.set(null);
  }
}
