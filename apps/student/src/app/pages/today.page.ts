import { Component, computed, inject, signal } from '@angular/core';
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
  EmptyState,
  Icon,
  LessonItem,
  type LessonItemStatus,
  type LessonItemType,
  RewardToast,
  StreakChip,
  XpBar,
} from '@codify/ui-ionic';
import { I18nService, type Locale } from '@codify/i18n';

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
    CourseCard,
    EmptyState,
    Icon,
    LessonItem,
    RewardToast,
    StreakChip,
    XpBar,
  ],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
})
export class TodayPage {
  private readonly i18n = inject(I18nService);
  protected readonly theme = signal<Theme>(this.readPersistedTheme());
  protected readonly locale = computed(() => this.i18n.currentLocale());

  // Gamification demo state.
  protected readonly demoXp = 1750;
  protected readonly demoCoins = 320;
  protected readonly demoStreak = 12;
  protected readonly demoFreezes = 2;

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
