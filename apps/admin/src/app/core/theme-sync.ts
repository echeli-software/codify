import { Injectable, inject } from '@angular/core';
import { AdminCatalogClient } from '@codify/api-client';
import {
  ThemeService,
  isThemeMode,
  type ThemeMode,
  type ThemePersistence,
} from '@codify/ui-bootstrap';

/** `THEME_PERSISTENCE`: saves the staff theme to the account (PATCH /me). */
@Injectable({ providedIn: 'root' })
export class AccountThemePersistence implements ThemePersistence {
  private readonly client = inject(AdminCatalogClient);

  async persist(mode: ThemeMode): Promise<void> {
    await this.client.setTheme(mode);
  }
}

/**
 * Adopt the account's saved theme after sign-in (docs/04 §7 "user
 * preference per-account, persisted"); the local copy is only a first-paint
 * hint. An account without a saved theme keeps the local choice.
 */
@Injectable({ providedIn: 'root' })
export class AccountThemeSync {
  private readonly client = inject(AdminCatalogClient);
  private readonly theme = inject(ThemeService);

  async sync(): Promise<void> {
    try {
      const saved = await this.client.getTheme();
      if (isThemeMode(saved) && saved !== this.theme.mode())
        this.theme.adopt(saved);
    } catch {
      /* offline / signed out — keep the local theme */
    }
  }
}
