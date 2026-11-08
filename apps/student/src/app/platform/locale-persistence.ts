import { Injectable, Injector, inject } from '@angular/core';
import { MeClient, toProblemDetails } from '@codify/api-client';
import { AuthService } from '@codify/auth';
import type { Locale, LocalePersistence } from '@codify/i18n';

/** `LOCALE_PERSISTENCE`: PATCH /me { locale } when signed in. */
@Injectable({ providedIn: 'root' })
export class StudentLocalePersistence implements LocalePersistence {
  private readonly me = inject(MeClient);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  persist(locale: Locale): Promise<unknown> | void {
    if (!this.auth.isAuthenticated()) return;
    this.auth.updateProfile({ locale });
    return this.me.update({ locale }).catch(async (err: unknown) => {
      // Offline (docs/16 §12 "User changes locale offline"): queue a
      // `preference_update` — the sync service is a lazy chunk.
      if (toProblemDetails(err).status !== 0) return;
      try {
        const { OfflineSyncService } =
          await import('../offline/offline-sync.service');
        await this.injector
          .get(OfflineSyncService)
          .updatePreferences({ locale });
      } catch {
        /* best-effort */
      }
    });
  }
}
