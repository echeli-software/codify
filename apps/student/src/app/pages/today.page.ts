import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonList,
  IonNote,
  IonLabel,
} from '@ionic/angular/standalone';
import {
  AppCard,
  AppCheckbox,
  AppChip,
  AppProgressBar,
  AppSelect,
  type AppSelectOption,
  AppSkeleton,
  AppToggle,
  CoinBadge,
  Icon,
  XpBadge,
} from '@codify/ui-ionic';
import { I18nService, type Locale } from '@codify/i18n';
import { levelFromXp, levelProgressPct, tierForLevel } from '@codify/ui-core';

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
    IonItem,
    IonList,
    IonNote,
    IonLabel,
    AppCard,
    AppCheckbox,
    AppChip,
    AppProgressBar,
    AppSelect,
    AppSkeleton,
    AppToggle,
    CoinBadge,
    Icon,
    XpBadge,
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
  protected readonly demoLevel = computed(() => levelFromXp(this.demoXp));
  protected readonly demoLevelProgress = computed(() => levelProgressPct(this.demoXp));
  protected readonly demoTier = computed(() => tierForLevel(this.demoLevel()));

  // Form-controls demo state.
  protected readonly notifyDaily = signal(true);
  protected readonly acceptTerms = signal(false);
  protected readonly localeChoice = signal<Locale>(this.i18n.currentLocale());
  protected readonly localeOptions: AppSelectOption<Locale>[] = this.i18n.availableLocales.map(
    (m) => ({ value: m.code, label: m.nativeName }),
  );

  // Skeleton loading-state simulation.
  protected readonly catalogLoading = signal(true);
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
