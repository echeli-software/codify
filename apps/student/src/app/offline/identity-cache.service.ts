import { Injectable, inject } from '@angular/core';
import { MeClient, ProblemDetailsError } from '@codify/api-client';
import { IdentityStore, type CachedIdentity } from './identity-store.js';
import { NetworkStatusService } from './network-status.service.js';

/**
 * Keeps `IdentityStore` in sync with `/api/me`.  Call `prime()` on app
 * boot after sign-in:
 *   - Online: GET /me → write to IdentityStore → return fresh.
 *   - Offline / 4xx / 5xx: fall back to whatever IdentityStore has on
 *     disk (or null if the user has never been online with this device).
 *
 * The cached bundle isn't *consumed* by anything UI-critical yet; the
 * shell still reads the live AuthService.  But persisting it now means
 * the future offline-boot path (per /docs/16-offline §4) has the data
 * already.  Phase 5b's probe verifies the cache writes and survives
 * page reload offline.
 */
@Injectable({ providedIn: 'root' })
export class IdentityCacheService {
  private readonly meClient = inject(MeClient);
  private readonly network = inject(NetworkStatusService);

  async prime(): Promise<CachedIdentity | null> {
    if (this.network.online()) {
      try {
        const me = await this.meClient.me();
        const bundle: CachedIdentity = {
          userId: me.id,
          email: me.email,
          displayName: me.displayName,
          locale: me.locale,
          role: me.role,
          totalXp: me.totalXp,
          coins: me.coins,
          fetchedAt: Date.now(),
        };
        await IdentityStore.set(bundle);
        return bundle;
      } catch (err) {
        // Token revoked or server unreachable mid-fetch — fall through
        // to whatever's cached. 401/403 are handled by the auth guard.
        if (
          !(err instanceof ProblemDetailsError) ||
          err.isServerError ||
          err.status === 0
        ) {
          return IdentityStore.get();
        }
        throw err;
      }
    }
    return IdentityStore.get();
  }

  cached(): Promise<CachedIdentity | null> {
    return IdentityStore.get();
  }

  async clear(): Promise<void> {
    await IdentityStore.clear();
  }
}
