import { Component, computed, inject, signal } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonProgressBar,
  IonButton,
  IonButtons,
  IonItem,
  IonList,
  IonNote,
  IonLabel,
} from '@ionic/angular/standalone';
import {
  AppCard,
  AppChip,
  CoinBadge,
  Icon,
  XpBadge,
} from '@codify/ui-ionic';
import { I18nService } from '@codify/i18n';
import { levelFromXp, levelProgressPct, tierForLevel } from '@codify/ui-core';

type Theme = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'codify.theme';

@Component({
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonProgressBar,
    IonButton,
    IonButtons,
    IonItem,
    IonList,
    IonNote,
    IonLabel,
    AppCard,
    AppChip,
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

  // Demo gamification numbers — proves ui-core + ui-ionic work end-to-end.
  protected readonly demoXp = 1750;
  protected readonly demoCoins = 320;
  protected readonly demoStreak = 12;
  protected readonly demoLevel = computed(() => levelFromXp(this.demoXp));
  protected readonly demoLevelProgress = computed(() => levelProgressPct(this.demoXp));
  protected readonly demoTier = computed(() => tierForLevel(this.demoLevel()));
  protected readonly progressFraction = computed(() => this.demoLevelProgress() / 100);

  constructor() {
    this.applyTheme(this.theme());
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
