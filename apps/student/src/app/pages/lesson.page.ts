import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  LessonsClient,
  type Lesson,
  ProgressClient,
  ProblemDetailsError,
  type CompleteLessonResponse,
} from '@codify/api-client';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { LessonBlockRenderer } from '@codify/ui-bootstrap';
import type { LessonDoc } from '@codify/lesson-schema';
import { RewardOrchestrator } from '@codify/gamification-engine';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  CoinBadge,
  EmptyState,
  Icon,
  XpBadge,
} from '@codify/ui-ionic';

/**
 * Student lesson player. Renders the read-only `LessonBlockRenderer`
 * over the lesson's `contentJson` and shows a "Mark as complete" CTA
 * that calls POST /api/lessons/:id/complete. The endpoint is idempotent
 * — replays return the original Progress row, so this CTA stays safe
 * even if the user mashes it.
 *
 * On first load we fetch /api/courses/:courseId/progress to see whether
 * this lesson is already done, so the UI can show the completed badge
 * instead of the CTA. (Phase 5b will swap this for a cached identity
 * bundle hydrated from IndexedDB.)
 *
 * Paid lessons surface a 402 — the API decides; the client just
 * presents the paywall placeholder until Phase 6 wires Stripe.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
    Icon,
    XpBadge,
    LessonBlockRenderer,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/catalog" />
        </ion-buttons>
        <ion-title>{{ lesson()?.title ?? 'Lesson' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <div class="lesson-skel">
        <cdf-app-skeleton shape="text" />
        <cdf-app-skeleton shape="text" />
        <cdf-app-skeleton shape="text" />
      </div>
      } @else if (paywall()) {
      <cdf-app-card padding="normal" class="lesson-paywall" data-testid="lesson-paywall">
        <cdf-icon name="shield" size="lg" />
        <h2>Premium lesson</h2>
        <p>
          This lesson is part of a subscription plan. Upgrade to unlock the
          full curriculum.
        </p>
      </cdf-app-card>
      } @else if (notFound()) {
      <cdf-empty-state
        icon="school"
        title="Lesson not available"
        description="It may have been unpublished or moved."
      />
      } @else if (lesson(); as l) {
      <article class="lesson-article" data-testid="lesson-article">
        <header class="lesson-article__head">
          <h1 class="lesson-article__title">{{ l.title }}</h1>
          <p class="lesson-article__meta">
            <cdf-icon name="hourglass" size="xs" />
            {{ l.estimatedMinutes }} min · {{ l.baseXp }} XP ·
            {{ l.baseCoins }} coins
          </p>
        </header>
        <cdf-lesson-block-renderer [doc]="docModel()" />
      </article>
      }
    </ion-content>
    @if (lesson() && !paywall()) {
    <ion-footer>
      <ion-toolbar>
        <div class="lesson-cta">
          @if (completed(); as p) {
          <div
            class="lesson-done"
            data-testid="lesson-completed"
            [attr.data-queued]="queued()"
          >
            <cdf-icon name="check-circle" size="md" />
            <span>{{ queued() ? 'Saved offline' : 'Completed' }}</span>
            <cdf-xp-badge [value]="p.xpAwarded" />
            <cdf-coin-badge [value]="p.coinsAwarded" />
            @if (queued()) {
            <small class="lesson-done__hint">Will sync when you're online.</small>
            }
          </div>
          } @else {
          <cdf-app-button
            kind="primary"
            size="md"
            [disabled]="completing()"
            data-testid="lesson-complete-btn"
            (buttonClick)="completeLesson($event)"
          >
            @if (completing()) { Saving… } @else { Mark as complete }
          </cdf-app-button>
          } @if (completeError(); as e) {
          <p class="lesson-cta__err">{{ e }}</p>
          }
        </div>
      </ion-toolbar>
    </ion-footer>
    }
  `,
  styles: [
    `
      .lesson-skel {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .lesson-article {
        max-width: 720px;
        margin: 0 auto;
      }
      .lesson-article__head {
        margin-bottom: var(--cdf-space-4);
      }
      .lesson-article__title {
        margin: 0 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-2xl);
        font-weight: 700;
      }
      .lesson-article__meta {
        margin: 0;
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .lesson-cta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2);
      }
      .lesson-done {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        font-weight: 600;
        color: var(--cdf-color-success);
      }
      .lesson-done[data-queued='true'] {
        color: var(--cdf-color-warning, #c87000);
      }
      .lesson-done__hint {
        width: 100%;
        font-weight: 400;
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
      }
      .lesson-cta__err {
        margin: 0;
        color: var(--cdf-color-danger);
        font-size: var(--cdf-font-size-sm);
      }
      .lesson-paywall {
        max-width: 480px;
        margin: var(--cdf-space-6) auto;
        text-align: center;
      }
      .lesson-paywall h2 {
        margin: var(--cdf-space-2) 0 var(--cdf-space-1);
      }
    `,
  ],
})
export class LessonPage {
  private readonly route = inject(ActivatedRoute);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly progressClient = inject(ProgressClient);
  private readonly sync = inject(OfflineSyncService);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly paywall = signal(false);
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly completed = signal<{
    xpAwarded: number;
    coinsAwarded: number;
  } | null>(null);
  /** True while the completion is sitting in the offline queue. */
  protected readonly queued = signal(false);
  protected readonly completing = signal(false);
  protected readonly completeError = signal<string | null>(null);

  protected readonly docModel = computed<LessonDoc | null>(() => {
    const l = this.lesson();
    return (l?.contentJson as LessonDoc) ?? null;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const id = pm.get('id');
      if (id) void this.load(id);
    });
    // Listen for sync events from the offline service.  When a queued
    // completion for *this* lesson syncs (or comes back 409), flip the
    // queued badge off and reflect canonical xp/coins.
    effect(() => {
      const r = this.sync.reconciled();
      const l = this.lesson();
      if (!r || !l || r.lessonId !== l.id) return;
      this.queued.set(false);
      this.completed.set({
        xpAwarded: r.response.progress.xpAwarded,
        coinsAwarded: r.response.progress.coinsAwarded,
      });
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.notFound.set(false);
    this.paywall.set(false);
    this.completed.set(null);
    this.completeError.set(null);
    try {
      const lesson = await this.lessonsClient.detail(id);
      this.lesson.set(lesson);
      // Best-effort: see whether this lesson is already done.
      try {
        const cp = await this.progressClient.forCourse(lesson.courseId);
        const item = cp.items.find((i) => i.lessonId === lesson.id);
        if (item) {
          this.completed.set({
            xpAwarded: item.xpAwarded,
            coinsAwarded: item.coinsAwarded,
          });
        }
      } catch {
        // Non-fatal — page still renders.
      }
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isNotFound) {
        this.notFound.set(true);
      } else {
        this.notFound.set(true);
      }
      this.lesson.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async completeLesson(ev?: MouseEvent): Promise<void> {
    const l = this.lesson();
    if (!l || this.completing()) return;
    this.completing.set(true);
    this.completeError.set(null);
    const sourceEl = (ev?.currentTarget as HTMLElement) ?? null;
    try {
      const outcome = await this.sync.completeLesson(l.id);
      if (outcome.status === 'synced' || outcome.status === 'conflict') {
        // Reconciled by the service via the `reconciled` signal effect
        // above, but set explicitly here too so the UI flips this tick.
        this.queued.set(false);
        this.completed.set({
          xpAwarded: outcome.response.progress.xpAwarded,
          coinsAwarded: outcome.response.progress.coinsAwarded,
        });
        // Server-authoritative reward → play the celebration through the
        // single RewardOrchestrator entry point, then reconcile exact totals.
        if (outcome.status === 'synced' && outcome.response.reward) {
          this.playReward(outcome.response, sourceEl);
        }
      } else {
        // Queued — show optimistic "Completed" with a will-sync badge.
        // Server award not yet known; show the lesson's nominal value.
        this.queued.set(true);
        this.completed.set({
          xpAwarded: l.baseXp,
          coinsAwarded: l.baseCoins,
        });
      }
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402) {
        this.paywall.set(true);
      } else if (err instanceof ProblemDetailsError) {
        this.completeError.set(err.message || 'Could not save your progress');
      } else {
        this.completeError.set('Could not save your progress');
      }
    } finally {
      this.completing.set(false);
    }
  }

  /**
   * Drive the reward celebration from the canonical server payload, then
   * reconcile the exact totals/streak (quest + badge bonuses may have added
   * more than the lesson's own award). Fire-and-forget — the animation must
   * not block the UI.
   */
  private playReward(res: CompleteLessonResponse, sourceEl: HTMLElement | null): void {
    const reward = res.reward;
    if (!reward) return;
    void this.orchestrator
      .grant({
        kind: 'lessonComplete',
        canonical: {
          xp: reward.xp,
          coins: reward.coins,
          multiplier: reward.multiplier,
          breakdown: reward.breakdown,
        },
        levelUp: reward.levelUp
          ? { newLevel: reward.levelUp.newLevel, xpForNextLevel: reward.levelUp.xpForNextLevel }
          : null,
        badgesUnlocked: (res.badgesUnlocked ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          icon: b.icon,
          description: b.description,
        })),
        sourceEl,
      })
      .then(() =>
        this.orchestrator.reconcile({
          totalXp: reward.totals.totalXp,
          coins: reward.totals.coins,
          streakDays: reward.streak?.currentDays,
          freezesAvailable: reward.streak?.freezesAvailable,
        }),
      );
  }
}
