import { Injectable, inject } from '@angular/core';
import { MeClient } from '@codify/api-client';
import { AuthService } from '@codify/auth';
import type { Locale, LocalePersistence } from '@codify/i18n';

/** `LOCALE_PERSISTENCE`: PATCH /me { locale } when signed in. */
@Injectable({ providedIn: 'root' })
export class StudentLocalePersistence implements LocalePersistence {
  private readonly me = inject(MeClient);
  private readonly auth = inject(AuthService);

  persist(locale: Locale): Promise<unknown> | void {
    if (!this.auth.isAuthenticated()) return;
    this.auth.updateProfile({ locale });
    return this.me.update({ locale }).catch(() => undefined);
  }
}
