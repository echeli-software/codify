import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonList,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppCard,
  AppCheckbox,
  AppSelect,
  type AppSelectOption,
  AppSkeleton,
  AppToggle,
  AvatarWithFrame,
  CoinBadge,
  CourseCard,
  type CourseCategoryRef,
  CoursePreviewModal,
  type CoursePreview,
  DailyQuestList,
  type DailyQuest,
  EmptyState,
  Icon,
  LessonItem,
  type LessonItemStatus,
  type LessonItemType,
  OnboardingCarousel,
  type OnboardingSlide,
  PaywallSheet,
  type PaywallContent,
  RewardToast,
  StreakChip,
  StreakWidget,
  type StreakDay,
  XpBar,
} from '@codify/ui-ionic';
import { I18nService, type Locale } from '@codify/i18n';
import {
  CoinService,
  CoinTarget,
  RewardOrchestrator,
  XpService,
  StreakService,
} from '@codify/gamification-engine';

interface ContinueLessonRow {
  title: string;
  subtitle: string;
  type: LessonItemType;
  status: LessonItemStatus;
  estimateMinutes: number;
  isFree: boolean;
}

interface Recommendation {
  id: string;
  title: string;
  author: string;
  lessonCount: number;
  estimatedMinutes: number;
  difficulty: string;
  categories: CourseCategoryRef[];
  hasFreePreview: boolean;
  premiumOnly?: boolean;
}

type Theme = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'codify.theme';

@Component({
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonButtons,
    IonList,
    AppButton,
    AppCard,
    AppCheckbox,
    AppSelect,
    AppSkeleton,
    AppToggle,
    AvatarWithFrame,
    CoinBadge,
    CoinTarget,
    CourseCard,
    CoursePreviewModal,
    DailyQuestList,
    EmptyState,
    Icon,
    LessonItem,
    OnboardingCarousel,
    PaywallSheet,
    RewardToast,
    StreakChip,
    StreakWidget,
    XpBar,
  ],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
})
export class TodayPage {
  private readonly i18n = inject(I18nService);
  private readonly orchestrator = inject(RewardOrchestrator);
  protected readonly xpSvc = inject(XpService);
  protected readonly coinSvc = inject(CoinService);
  protected readonly streakSvc = inject(StreakService);
  protected readonly theme = signal<Theme>(this.readPersistedTheme());
  protected readonly locale = computed(() => this.i18n.currentLocale());

  // Reward demo button — used as the source point for coin-fly.
  protected readonly rewardBtn = viewChild('rewardBtn', { read: ElementRef });

  // Last 7 days of streak (oldest first; today is last).
  protected readonly streakWeek: StreakDay[] = [
    { date: '2026-04-26', completed: true },
    { date: '2026-04-27', completed: true },
    { date: '2026-04-28', completed: false, frozen: true },
    { date: '2026-04-29', completed: true },
    { date: '2026-04-30', completed: true },
    { date: '2026-05-01', completed: true },
    { date: '2026-05-02', completed: true },
  ];

  protected readonly dailyQuests: DailyQuest[] = [
    {
      id: 'q1',
      title: 'Complete 1 React lesson',
      progress: 0,
      target: 1,
      xpReward: 25,
      coinReward: 10,
      kind: 'lesson-count',
    },
    {
      id: 'q2',
      title: 'Earn 100 XP today',
      progress: 20,
      target: 100,
      xpReward: 50,
      coinReward: 15,
      kind: 'xp-amount',
    },
    {
      id: 'q3',
      title: 'Pass an exercise',
      progress: 1,
      target: 1,
      xpReward: 30,
      coinReward: 12,
      kind: 'exercise-pass',
      completed: true,
    },
  ];

  // Form-controls demo state.
  protected readonly notifyDaily = signal(true);
  protected readonly acceptTerms = signal(false);
  protected readonly localeChoice = signal<Locale>(this.i18n.currentLocale());
  protected readonly localeOptions: AppSelectOption<Locale>[] = this.i18n.availableLocales.map(
    (m) => ({ value: m.code, label: m.nativeName }),
  );

  // Continue learning + recommendations (mock data — wired to API in Phase 5).
  protected readonly catalogLoading = signal(true);
  protected readonly continueLessons: ContinueLessonRow[] = [
    {
      title: 'Hooks intro',
      subtitle: 'React Fundamentals · Lesson 4 of 12',
      type: 'reading',
      status: 'in-progress',
      estimateMinutes: 5,
      isFree: false,
    },
    {
      title: 'Conditional rendering',
      subtitle: 'React Fundamentals · Lesson 5 of 12',
      type: 'quiz',
      status: 'not-started',
      estimateMinutes: 7,
      isFree: false,
    },
    {
      title: 'Building a counter',
      subtitle: 'React Fundamentals · Lesson 6 of 12',
      type: 'exercise',
      status: 'locked',
      estimateMinutes: 12,
      isFree: false,
    },
  ];

  protected readonly recommendations: Recommendation[] = [
    {
      id: 'r1',
      title: 'Prompt engineering with AI',
      author: 'Ana T.',
      lessonCount: 8,
      estimatedMinutes: 95,
      difficulty: 'Intermediário',
      categories: [{ id: 'ai', label: 'AI usage' }],
      hasFreePreview: true,
    },
    {
      id: 'r2',
      title: 'Capacitor for Angular devs',
      author: 'Lucas K.',
      lessonCount: 10,
      estimatedMinutes: 140,
      difficulty: 'Avançado',
      categories: [
        { id: 'mobile', label: 'Mobile' },
        { id: 'frontend', label: 'Frontend' },
      ],
      hasFreePreview: false,
      premiumOnly: true,
    },
    {
      id: 'r3',
      title: 'Reading code reviews',
      author: 'Priya M.',
      lessonCount: 5,
      estimatedMinutes: 60,
      difficulty: 'Iniciante',
      categories: [{ id: 'soft', label: 'Soft skills' }],
      hasFreePreview: true,
    },
  ];

  protected readonly noRecommendations = signal(false);

  // Modal / sheet demo state.
  protected readonly previewCourse = signal<CoursePreview | null>(null);
  protected readonly paywallOpen = signal(false);
  protected readonly onboardingOpen = signal(false);

  protected readonly paywallContent: PaywallContent = {
    title: 'Go Premium',
    subtitle: 'Unlock every course, no daily limits, exclusive content.',
    perks: [
      'Unlimited lessons across all courses',
      'Premium-only courses (advanced + AI tracks)',
      'Double XP on weekends',
      '+50% Mystery Chest drops',
    ],
    plans: [
      { id: 'monthly', name: 'Monthly', cadence: 'monthly', priceLabel: 'R$ 19,90/mo' },
      {
        id: 'yearly',
        name: 'Yearly',
        cadence: 'yearly',
        priceLabel: 'R$ 149/yr',
        badge: 'Save 37%',
        highlight: true,
      },
    ],
    footnote: 'Cancel anytime. Restore purchase from Profile > Settings.',
  };

  protected readonly onboardingSlides: OnboardingSlide[] = [
    {
      id: 's1',
      title: 'Learn by doing',
      body: 'Bite-sized lessons, quizzes, and code exercises — designed for daily practice.',
      icon: 'school',
    },
    {
      id: 's2',
      title: 'Build a streak',
      body: 'Finish at least one lesson a day to grow your flame and unlock weekly badges.',
      icon: 'flame',
    },
    {
      id: 's3',
      title: 'Earn rewards',
      body: 'XP, coins, levels, and Mystery Chests reward your progress.',
      icon: 'gift',
    },
  ];

  constructor() {
    this.applyTheme(this.theme());
    setTimeout(() => this.catalogLoading.set(false), 1500);
  }

  protected toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private browsing — ignore */
    }
  }

  protected onLocaleChange(value: Locale | null): void {
    if (value) {
      this.localeChoice.set(value);
      this.i18n.setLocale(value);
    }
  }

  protected toggleRecommendations(): void {
    this.noRecommendations.update((v) => !v);
  }

  protected openPreview(rec: Recommendation): void {
    this.previewCourse.set({
      id: rec.id,
      title: rec.title,
      description: `A short preview of ${rec.title}. The first lesson is free; the rest unlocks once you start.`,
      author: rec.author,
      lessonCount: rec.lessonCount,
      estimatedMinutes: rec.estimatedMinutes,
      difficulty: rec.difficulty,
      categories: rec.categories,
      hasFreePreview: rec.hasFreePreview,
      premiumOnly: rec.premiumOnly,
      curriculum: Array.from({ length: rec.lessonCount }, (_, i) => ({
        id: `${rec.id}-l${i + 1}`,
        title: `Lesson ${i + 1}`,
        type: i % 3 === 0 ? 'quiz' : i % 3 === 1 ? 'exercise' : 'reading',
        status: i === 0 ? 'in-progress' : (rec.premiumOnly && i > 0) ? 'locked' : 'not-started',
        estimateMinutes: 6 + (i % 4) * 2,
        isFree: i === 0 && rec.hasFreePreview,
      })),
    });
  }

  protected onPreviewStart(id: string): void {
    console.log('[demo] start course', id);
    this.previewCourse.set(null);
  }

  protected onPreviewUnlock(_id: string): void {
    this.previewCourse.set(null);
    this.paywallOpen.set(true);
  }

  protected onPaywallSelected(planId: string): void {
    console.log('[demo] paywall selected', planId);
    this.paywallOpen.set(false);
  }

  protected triggerReward(): void {
    const sourceEl = (this.rewardBtn()?.nativeElement as HTMLElement | undefined) ?? null;
    void this.orchestrator.grant({
      kind: 'lessonComplete',
      canonical: { xp: 25, coins: 10, multiplier: 1 },
      sourceEl,
    });
  }

  protected triggerLevelUp(): void {
    const sourceEl = (this.rewardBtn()?.nativeElement as HTMLElement | undefined) ?? null;
    void this.orchestrator.grant({
      kind: 'levelUp',
      canonical: { xp: 200, coins: 50 },
      levelUp: { newLevel: this.xpSvc.level() + 1, xpForNextLevel: 350 },
      sourceEl,
    });
  }

  protected triggerBadge(): void {
    const sourceEl = (this.rewardBtn()?.nativeElement as HTMLElement | undefined) ?? null;
    void this.orchestrator.grant({
      kind: 'badgeUnlock',
      canonical: { xp: 0, coins: 25 },
      badgesUnlocked: [
        {
          id: 'streak-7',
          name: 'Week Warrior',
          icon: 'flame',
          description: 'Held a 7-day learning streak.',
        },
      ],
      sourceEl,
    });
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') root.classList.add('theme-light');
    if (theme === 'dark') root.classList.add('theme-dark');
  }

  private readPersistedTheme(): Theme {
    try {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
