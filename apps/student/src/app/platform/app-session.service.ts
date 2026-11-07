import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@codify/auth';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { NativePlatformService } from '../native/native-platform.service.js';
import { DownloadService } from '../offline/download.service.js';
import { IdentityCacheService } from '../offline/identity-cache.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/**
 * Sign-in / sign-out lifecycle for the student app (docs/16 §4).
 *
 *   - On every sign-in (and on boot with a stored session): prime the
 *     offline identity bundle, reconcile the reward counters with the
 *     server totals, identify the RevenueCat customer + register push, and
 *     kick the opt-in auto-download of enrolled courses.
 *   - `requestSignOut()` is what UI "Sign out" buttons call: with unsynced
 *     progress it raises `signOutConfirm` (the shell shows a confirm sheet);
 *     `signOut()` then clears this user's queue, identity bundle, cached
 *     avatar assets and downloads before ending the auth session.
 *
 * A sign-out forced by an expired session (the auth interceptor's 401
 * path) does NOT go through here, so the queue survives and flushes when
 * the same user signs back in.
 */
@Injectable({ providedIn: 'root' })
export class AppSessionService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly identity = inject(IdentityCacheService);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly sync = inject(OfflineSyncService);
  private readonly downloads = inject(DownloadService);
  private readonly native = inject(NativePlatformService);
  private readonly network = inject(NetworkStatusService);
  private readonly telemetry = inject(TelemetryService);

  private lastUserId: string | null = null;
  private readonly _signOutConfirm = signal(false);
  private readonly _signingOut = signal(false);
  /** True while the "unsynced progress — sign out anyway?" sheet is open. */
  readonly signOutConfirm = this._signOutConfirm.asReadonly();
  readonly signingOut = this._signingOut.asReadonly();

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => void this.onUser(id));
    });
    effect(() => {
      // Back online → refresh the identity bundle (totals, subscription).
      if (this.network.online() && this.auth.user()) {
        untracked(() => void this.refreshIdentity());
      }
    });
  }

  /** No-op: injecting the service (root component) arms the watchers. */
  start(): void {
    /* effects are created in the constructor */
  }

  /** UI entry point for "Sign out". */
  async requestSignOut(): Promise<void> {
    if (this.sync.pendingCount() > 0) {
      this._signOutConfirm.set(true);
      return;
    }
    await this.signOut();
  }

  cancelSignOut(): void {
    this._signOutConfirm.set(false);
  }

  /** Clear everything cached for this user, then end the auth session. */
  async signOut(): Promise<void> {
    if (this._signingOut()) return;
    this._signingOut.set(true);
    this._signOutConfirm.set(false);
    const userId = this.auth.user()?.id ?? null;
    try {
      this.telemetry.track('signed_out', {
        unsynced: this.sync.pendingCount(),
      });
      await this.telemetry.flush();
      if (userId) await this.sync.clearForUser(userId).catch(() => 0);
      await this.identity.clear().catch(() => undefined);
      await this.downloads.removeAll().catch(() => undefined);
      await this.native.onSignedOut().catch(() => undefined);
      await this.auth.signOut();
    } finally {
      this._signingOut.set(false);
    }
    await this.router.navigateByUrl('/login');
  }

  private async onUser(id: string | null): Promise<void> {
    if (this.lastUserId === id) return;
    this.lastUserId = id;
    if (!id) return;
    this.telemetry.track('signed_in');
    const bundle = await this.refreshIdentity();
    if (this.auth.user()?.id !== id) return; // superseded
    if (!this.network.online() && this.identity.isExpired(bundle)) {
      // docs/16 §4: offline identity is valid for 30 days after the last
      // refresh; past that, back to sign-in. Not destructive — the queue
      // and downloads stay for when the same user signs in again.
      this.telemetry.track('offline_identity_expired');
      await this.auth.signOut();
      await this.router.navigateByUrl('/login');
      return;
    }
    await this.native
      .onSignedIn(bundle?.serverUserId ?? id)
      .catch(() => undefined);
    void this.downloads.syncEnrolledDownloads();
  }

  private refreshing: Promise<
    Awaited<ReturnType<IdentityCacheService['prime']>>
  > | null = null;

  private refreshIdentity() {
    if (!this.refreshing) {
      this.refreshing = this.identity
        .prime()
        .then((b) => {
          if (b) {
            this.orchestrator.reconcile({
              totalXp: b.totalXp,
              coins: b.coins,
              level: b.level,
              streakDays: b.streakDays,
              freezesAvailable: b.freezesAvailable,
              bestDays: b.longestStreakDays,
            });
          }
          return b;
        })
        .catch(() => null)
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }
}
