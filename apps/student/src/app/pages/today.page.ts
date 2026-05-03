import { Component, computed, inject, signal } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonChip,
  IonLabel,
  IonProgressBar,
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonList,
  IonNote,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { flame, sparkles, trophy, sunny, moon } from 'ionicons/icons';
import { I18nService } from '@codify/i18n';
import {
  formatCoins,
  formatXp,
  levelFromXp,
  levelProgressPct,
  tierForLevel,
} from '@codify/ui-core';

type Theme = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'codify.theme';

@Component({
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonChip,
    IonLabel,
    IonProgressBar,
    IonButton,
    IonButtons,
    IonIcon,
    IonItem,
    IonList,
    IonNote,
  ],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
})
export class TodayPage {
  private readonly i18n = inject(I18nService);
  protected readonly theme = signal<Theme>(this.readPersistedTheme());
  protected readonly locale = computed(() => this.i18n.currentLocale());

  // Demo gamification numbers — proves ui-core works end-to-end.
  protected readonly demoXp = 1750;
  protected readonly demoCoins = 320;
  protected readonly demoStreak = 12;
  protected readonly demoLevel = computed(() => levelFromXp(this.demoXp));
  protected readonly demoLevelProgress = computed(() => levelProgressPct(this.demoXp));
  protected readonly demoTier = computed(() => tierForLevel(this.demoLevel()));
  protected readonly xpLabel = computed(() => formatXp(this.demoXp, this.locale()));
  protected readonly coinLabel = computed(() => formatCoins(this.demoCoins, this.locale()));
  protected readonly progressFraction = computed(() => this.demoLevelProgress() / 100);

  constructor() {
    addIcons({ flame, sparkles, trophy, sunny, moon });
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

  protected setLocale(value: string): void {
    if (value === 'pt-BR' || value === 'en-US') {
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
