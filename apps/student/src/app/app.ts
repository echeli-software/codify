import { Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
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
  imports: [RouterModule, TranslatePipe],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly i18n = inject(I18nService);
  protected readonly theme = signal<Theme>(this.readPersistedTheme());
  protected readonly locale = computed(() => this.i18n.currentLocale());
  protected readonly availableLocales = this.i18n.availableLocales;

  // Demo gamification numbers — proves ui-core works end-to-end.
  protected readonly demoXp = 1750;
  protected readonly demoCoins = 320;
  protected readonly demoLevel = computed(() => levelFromXp(this.demoXp));
  protected readonly demoLevelProgress = computed(() => levelProgressPct(this.demoXp));
  protected readonly demoTier = computed(() => tierForLevel(this.demoLevel()));
  protected readonly xpLabel = computed(() => formatXp(this.demoXp, this.locale()));
  protected readonly coinLabel = computed(() => formatCoins(this.demoCoins, this.locale()));

  constructor() {
    this.applyTheme(this.theme());
  }

  protected setTheme(value: Theme): void {
    this.theme.set(value);
    this.applyTheme(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
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
