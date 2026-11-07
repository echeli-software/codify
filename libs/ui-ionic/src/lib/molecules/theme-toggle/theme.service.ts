import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'codify.theme';

/**
 * Theme mode for the student app (same storage key + `<html>` classes as
 * the admin `ThemeService`, so tokens behave identically):
 * `theme-light` / `theme-dark`, or neither for `system`
 * (`prefers-color-scheme`). Also toggles Ionic's `ion-palette-dark`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _mode = signal<ThemeMode>(this.readPersisted());
  readonly mode = this._mode.asReadonly();
  readonly isDark = computed(() => this._mode() === 'dark');

  constructor() {
    this.apply(this._mode());
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    this.apply(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private browsing — ignore */
    }
  }

  private apply(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'ion-palette-dark');
    if (mode === 'light') root.classList.add('theme-light');
    if (mode === 'dark') root.classList.add('theme-dark', 'ion-palette-dark');
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
