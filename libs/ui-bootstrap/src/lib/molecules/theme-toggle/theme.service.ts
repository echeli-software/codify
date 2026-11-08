import {
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system' | 'high-contrast';

export const THEME_MODES: readonly ThemeMode[] = [
  'light',
  'dark',
  'system',
  'high-contrast',
];

const STORAGE_KEY = 'codify.theme';

/**
 * Optional server-side persistence of the theme (docs/04 §7 "user
 * preference per-account, persisted"). The admin app provides one that
 * PATCHes `/me { theme }`.
 */
export interface ThemePersistence {
  persist(mode: ThemeMode): Promise<void>;
}

export const THEME_PERSISTENCE = new InjectionToken<ThemePersistence>(
  'THEME_PERSISTENCE',
);

export function isThemeMode(v: unknown): v is ThemeMode {
  return (
    typeof v === 'string' && (THEME_MODES as readonly string[]).includes(v)
  );
}

/** `<html>` classes for a mode (the stylesheets key off these). */
export function themeClasses(mode: ThemeMode): string[] {
  if (mode === 'light') return ['theme-light'];
  if (mode === 'dark') return ['theme-dark'];
  // High contrast is a light-based token set; `theme-light` keeps the dark
  // media query from applying underneath it.
  if (mode === 'high-contrast') return ['theme-light', 'theme-hc'];
  return [];
}

/**
 * Singleton theme manager. Persists the choice to localStorage (and, when a
 * `THEME_PERSISTENCE` is provided, to the account) and toggles the
 * `theme-light` / `theme-dark` / `theme-hc` classes on `<html>`. The
 * `system` mode removes them so `prefers-color-scheme` takes over (the
 * styles.scss media query handles that case).
 *
 * Provided in root so any component can inject + react to changes.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private remote: ThemePersistence | null = inject(THEME_PERSISTENCE, {
    optional: true,
  });
  private readonly _mode = signal<ThemeMode>(this.readPersisted());
  readonly mode = this._mode.asReadonly();
  readonly isLight = computed(() => this._mode() === 'light');
  readonly isDark = computed(() => this._mode() === 'dark');
  readonly isSystem = computed(() => this._mode() === 'system');
  readonly isHighContrast = computed(() => this._mode() === 'high-contrast');

  constructor() {
    this.apply(this._mode());
  }

  /**
   * Attach account persistence after start-up (e.g. from a lazily loaded
   * shell, where a root `THEME_PERSISTENCE` provider isn't available).
   */
  usePersistence(persistence: ThemePersistence | null): void {
    this.remote = persistence;
  }

  /** User choice: apply, remember locally and save to the account. */
  setMode(mode: ThemeMode): void {
    this.adopt(mode);
    void this.remote?.persist(mode).catch(() => undefined);
  }

  /** Apply a mode that came from the account (no save back). */
  adopt(mode: ThemeMode): void {
    this._mode.set(mode);
    this.apply(mode);
    this.persist(mode);
  }

  private apply(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-hc');
    root.classList.add(...themeClasses(mode));
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
      if (isThemeMode(v)) return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
