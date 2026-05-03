import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'codify.theme';

/**
 * Singleton theme manager. Persists choice to localStorage and toggles the
 * `theme-light` / `theme-dark` class on `<html>`. The `system` mode removes
 * both classes so `prefers-color-scheme` takes over (the styles.scss media
 * query handles that case).
 *
 * Provided in root so any component can inject + react to changes.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _mode = signal<ThemeMode>(this.readPersisted());
  readonly mode = this._mode.asReadonly();
  readonly isLight = computed(() => this._mode() === 'light');
  readonly isDark = computed(() => this._mode() === 'dark');
  readonly isSystem = computed(() => this._mode() === 'system');

  constructor() {
    this.apply(this._mode());
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    this.apply(mode);
    this.persist(mode);
  }

  private apply(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (mode === 'light') root.classList.add('theme-light');
    if (mode === 'dark') root.classList.add('theme-dark');
  }

  private persist(mode: ThemeMode): void {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private browsing — ignore */
    }
  }

  private readPersisted(): ThemeMode {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
