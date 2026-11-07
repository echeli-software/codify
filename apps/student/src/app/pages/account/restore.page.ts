import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AccountClient, type AccountStatusView } from '@codify/api-client';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AppButton, AppCard, AppSkeleton, Icon } from '@codify/ui-ionic';
import { AppSessionService } from '../../platform/app-session.service.js';
import { AppToastService } from '../../platform/app-toast.service.js';
import { FeatureFlagsService } from '../../platform/feature-flags.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { AccountStateService } from './account-state.js';

/**
 * Shown while the signed-in account is soft-deleted (docs/14 §13): restore
 * inside the 14-day window, or sign out. Outside the shell — every other
 * API route answers 403 ACCOUNT_DELETED for this account.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppSkeleton,
    Icon,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.account.restore.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <main class="acc" data-testid="account-restore">
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="220" />
        } @else {
          <cdf-app-card padding="spacious">
            <div class="acc__icon" aria-hidden="true">
              <cdf-icon name="trash" size="lg" />
            </div>
            @if (restorableUntil(); as until) {
              <h1>{{ 'student.account.restore.heading' | translate }}</h1>
              <p>
                {{
                  'student.account.restore.body'
                    | translate: { date: (until | locale: 'date' : 'long') }
                }}
              </p>
              @if (purgeAt(); as purge) {
                <p class="acc__muted">
                  {{
                    'student.account.restore.purge'
                      | translate: { date: (purge | locale: 'date' : 'long') }
                  }}
                </p>
              }
              @if (storeSubscriptions().length > 0) {
                <div class="acc__notice" role="note">
                  <cdf-icon name="warning" size="sm" />
                  <span>{{
                    'student.account.restore.storeReminder' | translate
                  }}</span>
                </div>
              }
              <div class="acc__actions">
                <cdf-app-button
                  kind="primary"
                  [loading]="restoring()"
                  (buttonClick)="restore()"
                  data-testid="restore-account"
                  >{{
                    'student.account.restore.cta' | translate
                  }}</cdf-app-button
                >
                <cdf-app-button
                  kind="ghost"
                  [loading]="signingOut()"
                  (buttonClick)="signOut()"
                  data-testid="restore-sign-out"
                  >{{ 'common.signOut' | translate }}</cdf-app-button
                >
              </div>
            } @else {
              <h1>{{ 'student.account.deleted.heading' | translate }}</h1>
              <p>{{ 'student.account.deleted.body' | translate }}</p>
              <div class="acc__actions">
                <cdf-app-button
                  kind="primary"
                  [loading]="signingOut()"
                  (buttonClick)="signOut()"
                  data-testid="restore-sign-out"
                  >{{ 'common.signOut' | translate }}</cdf-app-button
                >
              </div>
            }
          </cdf-app-card>
        }
      </main>
    </ion-content>
  `,
  styles: [
    `
      .acc {
        max-width: 560px;
        margin: var(--cdf-space-4) auto 0;
      }
      .acc__icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--cdf-color-danger-subtle, #fee2e2);
        color: var(--cdf-color-danger, #dc2626);
        margin-bottom: var(--cdf-space-2);
      }
      h1 {
        font-size: var(--cdf-font-size-lg);
        margin: 0 0 var(--cdf-space-2);
      }
      p {
        margin: 0 0 var(--cdf-space-2);
        line-height: 1.5;
      }
      .acc__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .acc__notice {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        padding: var(--cdf-space-2) var(--cdf-space-3);
        border-radius: 12px;
        background: var(--cdf-color-warning-subtle, #fef3c7);
        margin-bottom: var(--cdf-space-2);
        font-size: var(--cdf-font-size-sm);
      }
      .acc__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-3);
      }
    `,
  ],
})
export class AccountRestorePage {
  private readonly account = inject(AccountClient);
  private readonly state = inject(AccountStateService);
  private readonly session = inject(AppSessionService);
  private readonly flags = inject(FeatureFlagsService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly restoring = signal(false);
  protected readonly signingOut = this.session.signingOut;
  private readonly status = signal<AccountStatusView | null>(null);

  protected readonly restorableUntil = computed(() => {
    const s = this.status();
    if (s) return s.restorableUntil;
    const b = this.state.block();
    return b?.kind === 'deleted' ? b.restorableUntil : null;
  });
  protected readonly purgeAt = computed(() => this.status()?.purgeAt ?? null);
  protected readonly storeSubscriptions = computed(
    () => this.state.lastDeletion()?.storeSubscriptions ?? [],
  );

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const s = await this.account.status();
      this.status.set(s);
      if (s.status === 'active') {
        this.state.clear();
        await this.router.navigateByUrl('/today');
      } else if (s.status === 'suspended') {
        this.state.set({ kind: 'suspended' });
        await this.router.navigateByUrl('/account/suspended');
      }
    } catch {
      // Offline / transient: fall back to what the 403 told us.
    } finally {
      this.loading.set(false);
    }
  }

  protected async restore(): Promise<void> {
    if (this.restoring()) return;
    this.restoring.set(true);
    try {
      await this.account.restore();
      this.state.clear();
      this.telemetry.track('account_restored');
      void this.flags.load();
      this.toast.show({
        message: 'student.account.restore.done',
        kind: 'success',
      });
      await this.router.navigateByUrl('/today');
    } catch (err) {
      this.toast.error(err);
      void this.refresh();
    } finally {
      this.restoring.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.state.clear();
    await this.session.signOut();
  }
}
