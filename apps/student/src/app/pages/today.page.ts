import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  type RefresherCustomEvent,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppCard,
  AppProgressBar,
  AppSkeleton,
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  CoinBadge,
  CourseCard,
  DailyQuestList,
  type DailyQuest,
  EmptyState,
  Icon,
  LevelBadge,
  StreakChip,
  XpBar,
  type OnboardingSlide,
} from '@codify/ui-ionic';
import { ContentTranslatePipe, I18nService, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  CoinService,
  CoinTarget,
  RewardOrchestrator,
  StreakService,
  XpService,
} from '@codify/gamification-engine';
import {
  CategoriesClient,
  CoursesClient,
  EnrollmentsClient,
  GamificationClient,
  ItemsClient,
  LeaguesClient,
  MeClient,
  ProgressClient,
  type AvatarResponse,
  type Category,
  type CourseListItem,
  type CurrentLeague,
  type MyEnrollment,
  type QuestView,
} from '@codify/api-client';
import { AppToastService } from '../platform/app-toast.service.js';
import {
  OnboardingFlowComponent,
  type OnboardingGoal,
} from '../components/onboarding-flow.component.js';
import { GrowthLinksService } from './shared/growth-links.service.js';
import { DownloadService } from '../offline/download.service.js';
import { formatCountdown } from './shared/countdown.js';

const KIND_MAP: Record<QuestView['kind'], DailyQuest['kind']> = {
  LESSON_COUNT: 'lesson-count',
  CATEGORY_LESSON_COUNT: 'category-lesson-count',
  XP_AMOUNT: 'xp-amount',
  STREAK_MAINTAIN: 'streak-maintain',
  EXERCISE_PASS: 'exercise-pass',
};

const ONBOARDING_KEY = 'codify.onboarding.';

interface ContinueCard {
  enrollment: MyEnrollment;
  lessonId: string | null;
  lessonTitle: string | null;
  pct: number;
}

/** Map a server QuestView to the ui-ionic DailyQuest shape. */
export function toDailyQuest(q: QuestView): DailyQuest {
  return {
    id: q.id,
    title: q.title,
    progress: q.progress,
    target: q.target,
    xpReward: q.xpReward,
    coinReward: q.coinReward,
    kind: KIND_MAP[q.kind],
    completed: q.completed,
  };
}

/** The enrollment to resume: started but unfinished first, then newest. */
export function pickContinue(
  items: readonly MyEnrollment[],
): MyEnrollment | null {
  const open = items.filter(
    (e) =>
      e.progress.totalLessons === 0 ||
      e.progress.completedLessons < e.progress.totalLessons,
  );
  if (open.length === 0) return null;
  return [...open].sort((a, b) => {
    const sa = a.progress.completedLessons > 0 ? 1 : 0;
    const sb = b.progress.completedLessons > 0 ? 1 : 0;
    return sb - sa || b.createdAt.localeCompare(a.createdAt);
  })[0];
}

/** Should first-run onboarding show? New accounts with no XP and no courses. */
export function needsOnboarding(opts: {
  totalXp: number;
  enrollments: number;
  dismissed: boolean;
}): boolean {
  return !opts.dismissed && opts.totalXp === 0 && opts.enrollments === 0;
}

/**
 * Today (docs/05 §3): greeting + streak / level / coins from the canonical
 * gamification summary, "continue learning" from the learner's enrollments,
 * today's quests, the league widget and course recommendations. First-run
 * accounts get the onboarding flow. Everything is real data; failures show
 * per-section states and a toast.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    AppButton,
    AppCard,
    AppProgressBar,
    AppSkeleton,
    AvatarRenderer,
    CoinBadge,
    CoinTarget,
    CourseCard,
    DailyQuestList,
    EmptyState,
    Icon,
    LevelBadge,
    StreakChip,
    XpBar,
    OnboardingFlowComponent,
    TranslatePipe,
    ContentTranslatePipe,
  ],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
})
export class TodayPage {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly toast = inject(AppToastService);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly gamification = inject(GamificationClient);
  private readonly enrollments = inject(EnrollmentsClient);
  private readonly courses = inject(CoursesClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly progress = inject(ProgressClient);
  private readonly leagues = inject(LeaguesClient);
  private readonly meClient = inject(MeClient);
  private readonly items = inject(ItemsClient);
  private readonly growth = inject(GrowthLinksService);
  private readonly downloads = inject(DownloadService);
  protected readonly xpSvc = inject(XpService);
  protected readonly coinSvc = inject(CoinService);
  protected readonly streakSvc = inject(StreakService);

  protected readonly displayName = computed(
    () => this.auth.user()?.displayName ?? '',
  );
  protected readonly loadingSummary = signal(true);
  protected readonly loadingLearning = signal(true);
  protected readonly quests = signal<DailyQuest[] | null>(null);
  protected readonly questsFailed = signal(false);
  protected readonly continueCard = signal<ContinueCard | null>(null);
  protected readonly enrollmentCount = signal(0);
  protected readonly catalog = signal<CourseListItem[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly league = signal<CurrentLeague | null>(null);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly onboarding = signal(false);
  protected readonly now = signal(Date.now());
  private enrolledCourseIds = new Set<string>();

  protected readonly recommendations = computed(() =>
    this.catalog()
      .filter((c) => !this.enrolledCourseIds.has(c.id))
      .slice(0, 3),
  );

  protected readonly equipped = computed<
    Partial<Record<AvatarSlot, AvatarSprite>>
  >(() => {
    const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    for (const [slot, ref] of Object.entries(this.avatar()?.equipped ?? {})) {
      if (ref)
        out[slot as AvatarSlot] = {
          spriteAssetId: ref.spriteAssetId,
          name: ref.name,
          rarity: ref.rarity,
        };
    }
    return out;
  });

  protected readonly leagueReset = computed(() => {
    const lg = this.league();
    this.i18n.currentLocale();
    return lg
      ? formatCountdown(new Date(lg.resetAt).getTime() - this.now(), (k, p) =>
          this.i18n.t(k, p),
        )
      : '';
  });

  protected readonly slides = computed<OnboardingSlide[]>(() => {
    this.i18n.currentLocale();
    const t = (k: string) => this.i18n.t(k);
    return [
      {
        id: 'learn',
        icon: 'school',
        title: t('student.onboarding.slides.learn.title'),
        body: t('student.onboarding.slides.learn.body'),
      },
      {
        id: 'streak',
        icon: 'flame',
        title: t('student.onboarding.slides.streak.title'),
        body: t('student.onboarding.slides.streak.body'),
      },
      {
        id: 'rewards',
        icon: 'gift',
        title: t('student.onboarding.slides.rewards.title'),
        body: t('student.onboarding.slides.rewards.body'),
      },
    ];
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.loadAll();
    if (this.growth.hasPending()) void this.claimGrowth();
  }

  protected async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await this.loadAll();
    await ev.target.complete();
  }

  private async loadAll(): Promise<void> {
    const [totalXp, enrollments] = await Promise.all([
      this.loadSummary(),
      this.loadLearning(),
      this.loadLeague(),
      this.loadAvatar(),
    ]);
    if (totalXp !== null && enrollments !== null)
      void this.maybeOnboard(totalXp, enrollments);
  }

  /** Canonical XP / coins / streak + today's quests. */
  private async loadSummary(): Promise<number | null> {
    try {
      const [summary, quests] = await Promise.all([
        this.gamification.summary(),
        this.gamification.questsToday().catch(() => {
          this.questsFailed.set(true);
          return [] as QuestView[];
        }),
      ]);
      this.orchestrator.reconcile({
        totalXp: summary.totalXp,
        coins: summary.coins,
        streakDays: summary.streak.currentDays,
        freezesAvailable: summary.streak.freezesAvailable,
      });
      this.quests.set(quests.map(toDailyQuest));
      return summary.totalXp;
    } catch (err) {
      this.toast.error(err);
      return null;
    } finally {
      this.loadingSummary.set(false);
    }
  }

  /** Enrollments → continue card; catalog → recommendations + onboarding. */
  private async loadLearning(): Promise<number | null> {
    try {
      const [mine, catalog, categories] = await Promise.all([
        this.enrollments.mine(),
        this.courses.list({ status: 'PUBLISHED', take: 24 }),
        this.categoriesClient
          .list({ take: 100 })
          .then((r) => r.items)
          .catch(() => []),
      ]);
      this.enrolledCourseIds = new Set(mine.map((e) => e.courseId));
      this.enrollmentCount.set(mine.length);
      this.catalog.set(catalog.items);
      this.categories.set(categories);
      const pick = pickContinue(mine);
      this.continueCard.set(pick ? await this.resolveNextLesson(pick) : null);
      return mine.length;
    } catch (err) {
      this.toast.error(err);
      return null;
    } finally {
      this.loadingLearning.set(false);
    }
  }

  /** First lesson of the course the learner hasn't completed yet. */
  private async resolveNextLesson(e: MyEnrollment): Promise<ContinueCard> {
    const pct = e.progress.totalLessons
      ? Math.round(
          (e.progress.completedLessons / e.progress.totalLessons) * 100,
        )
      : 0;
    try {
      const [detail, prog] = await Promise.all([
        this.courses.detail(e.course.slug),
        this.progress.forCourse(e.courseId),
      ]);
      const done = new Set(prog.items.map((i) => i.lessonId));
      const next =
        detail.modules.flatMap((m) => m.lessons).find((l) => !done.has(l.id)) ??
        null;
      return {
        enrollment: e,
        lessonId: next?.id ?? null,
        lessonTitle: next?.title ?? null,
        pct,
      };
    } catch {
      return { enrollment: e, lessonId: null, lessonTitle: null, pct };
    }
  }

  private async loadLeague(): Promise<void> {
    try {
      this.league.set(await this.leagues.currentLeague());
    } catch {
      // No cohort yet this week (404) or offline — the widget just hides.
      this.league.set(null);
    }
  }

  private async loadAvatar(): Promise<void> {
    try {
      this.avatar.set(await this.items.avatar());
    } catch {
      // Falls back to the initials avatar.
      this.avatar.set(null);
    }
  }

  private onboardingKey(): string | null {
    const id = this.auth.user()?.id;
    return id ? ONBOARDING_KEY + id : null;
  }

  /**
   * The server's `onboardedAt` is the source of truth (it follows the
   * learner across devices); the local key only saves the /me round trip.
   */
  private async maybeOnboard(
    totalXp: number,
    enrollments: number,
  ): Promise<void> {
    const key = this.onboardingKey();
    if (!key) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) !== null;
    } catch {
      dismissed = false;
    }
    if (!needsOnboarding({ totalXp, enrollments, dismissed })) return;
    try {
      const me = await this.meClient.me();
      dismissed = me.onboardedAt !== null;
    } catch {
      // Can't confirm (offline): don't interrupt with onboarding.
      dismissed = true;
    }
    this.onboarding.set(needsOnboarding({ totalXp, enrollments, dismissed }));
  }

  protected async onOnboardingDone(ev: {
    goal: OnboardingGoal | null;
    course: CourseListItem | null;
  }): Promise<void> {
    this.onboarding.set(false);
    const key = this.onboardingKey();
    try {
      if (key)
        localStorage.setItem(
          key,
          JSON.stringify({ goal: ev.goal, at: new Date().toISOString() }),
        );
    } catch {
      // Storage unavailable: the server flag below still applies.
    }
    this.meClient.update({ onboarded: true }).catch(() => {
      // Offline: the local key keeps it dismissed on this device.
    });
    if (!ev.course) return;
    try {
      await this.enrollments.enroll(ev.course.id);
      this.downloads.onEnrolled(ev.course.id);
    } catch (err) {
      this.toast.error(err);
    }
    void this.router.navigate(['/courses', ev.course.slug]);
  }

  private async claimGrowth(): Promise<void> {
    const res = await this.growth.claimPending();
    if (res.referral === 'claimed') {
      this.toast.show({
        message: 'student.growth.referral.claimed',
        kind: 'success',
      });
    }
    if (res.invite && res.invite.status === 'accepted') {
      this.toast.show({
        message: 'student.growth.invite.accepted',
        kind: 'success',
        params: { name: res.invite.friendName },
      });
    }
  }
}
