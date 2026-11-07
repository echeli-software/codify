import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import {
  AccountClient,
  BillingClient,
  EXPORT_RATE_LIMITED,
  ProblemDetailsError,
  type SubscriptionView,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppCard,
  AppCheckbox,
  BottomSheet,
  Icon,
} from '@codify/ui-ionic';
import { AppToastService } from '../../platform/app-toast.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { AccountStateService, RESTORE_PATH } from '../account/account-state.js';

/**
 * Settings → Data & privacy (docs/14 §13, docs/05 Settings): download a
 * JSON export of everything we hold, and self-service account deletion
 * with a single confirm sheet that explains the 14-day restore window,
 * the 30-day anonymisation and what happens to subscriptions.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppCheckbox,
    BottomSheet,
    Icon,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/profile"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{ 'student.privacy.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="pv" data-testid="privacy-page">
        <section aria-labelledby="pv-export">
          <cdf-app-card padding="normal">
            <h2 id="pv-export">
              <cdf-icon name="download" size="sm" />
              {{ 'student.privacy.export.title' | translate }}
            </h2>
            <p>{{ 'student.privacy.export.body' | translate }}</p>
            <cdf-app-button
              kind="secondary"
              [loading]="exporting()"
              (buttonClick)="exportData()"
              data-testid="export-data"
              >{{ 'student.privacy.export.cta' | translate }}</cdf-app-button
            >
          </cdf-app-card>
        </section>

        <section aria-labelledby="pv-delete">
          <cdf-app-card padding="normal">
            <h2 id="pv-delete" class="pv__danger">
              <cdf-icon name="trash" size="sm" />
              {{ 'student.privacy.delete.title' | translate }}
            </h2>
            <p>{{ 'student.privacy.delete.body' | translate }}</p>
            <cdf-app-button
              kind="danger"
              (buttonClick)="openConfirm()"
              data-testid="delete-account"
              >{{ 'student.privacy.delete.cta' | translate }}</cdf-app-button
            >
          </cdf-app-card>
        </section>
      </div>

      <cdf-bottom-sheet
        [(open)]="confirmOpen"
        [title]="'student.privacy.confirm.title' | translate"
      >
        <div class="pv__confirm" data-testid="delete-confirm">
          <ul class="pv__facts">
            <li>
              <cdf-icon name="refresh" size="sm" />
              <span>{{ 'student.privacy.confirm.restore' | translate }}</span>
            </li>
            <li>
              <cdf-icon name="trash" size="sm" />
              <span>{{ 'student.privacy.confirm.purge' | translate }}</span>
            </li>
            <li>
              <cdf-icon name="diamond" size="sm" />
              <span>{{
                (hasWebRenewal()
                  ? 'student.privacy.confirm.webSubscription'
                  : 'student.privacy.confirm.noWebSubscription'
                ) | translate
              }}</span>
            </li>
            @if (hasStoreSubscription()) {
              <li class="pv__warn" data-testid="store-warning">
                <cdf-icon name="warning" size="sm" />
                <span>{{
                  'student.privacy.confirm.storeSubscription' | translate
                }}</span>
              </li>
            }
            <li>
              <cdf-icon name="info-circle" size="sm" />
              <span>{{
                'student.privacy.confirm.exportFirst' | translate
              }}</span>
            </li>
          </ul>
          <cdf-app-checkbox
            [label]="'student.privacy.confirm.acknowledge' | translate"
            [(ngModel)]="acknowledged"
            data-testid="delete-acknowledge"
          />
        </div>
        <div sheetFooter class="pv__footer">
          <cdf-app-button kind="ghost" (buttonClick)="confirmOpen.set(false)">{{
            'common.cancel' | translate
          }}</cdf-app-button>
          <cdf-app-button
            kind="danger"
            [disabled]="!acknowledged()"
            [loading]="deleting()"
            (buttonClick)="deleteAccount()"
            data-testid="delete-confirm-btn"
            >{{ 'student.privacy.confirm.cta' | translate }}</cdf-app-button
          >
        </div>
      </cdf-bottom-sheet>
    </ion-content>
  `,
  styles: [
    `
      .pv {
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-1);
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md, 1rem);
      }
      p {
        margin: 0 0 var(--cdf-space-3);
        color: var(--cdf-color-text-muted);
        line-height: 1.5;
      }
      .pv__danger {
        color: var(--cdf-color-danger, #dc2626);
      }
      .pv__facts {
        list-style: none;
        margin: 0 0 var(--cdf-space-3);
        padding: 0;
        display: grid;
        gap: var(--cdf-space-2);
      }
      .pv__facts li {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        line-height: 1.45;
      }
      .pv__facts cdf-icon {
        flex: none;
        margin-top: 2px;
      }
      .pv__warn {
        padding: var(--cdf-space-2);
        border-radius: 10px;
        background: var(--cdf-color-warning-subtle, #fef3c7);
      }
      /* Long acknowledgement labels wrap instead of being cut off. */
      .pv__confirm ::ng-deep ion-checkbox::part(label) {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
      }
      .pv__footer {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
    `,
  ],
})
export class PrivacyPage {
  private readonly account = inject(AccountClient);
  private readonly billing = inject(BillingClient);
  private readonly state = inject(AccountStateService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly router = inject(Router);

  protected readonly exporting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly acknowledged = signal(false);
  private readonly subscriptions = signal<SubscriptionView[]>([]);

  /** Live subscriptions that would keep renewing without action. */
  private readonly renewing = computed(() =>
    this.subscriptions().filter((s) => s.grantsAccess && s.renews),
  );
  protected readonly hasWebRenewal = computed(() =>
    this.renewing().some((s) => s.source === 'STRIPE_WEB'),
  );
  protected readonly hasStoreSubscription = computed(() =>
    this.renewing().some(
      (s) => s.source === 'APPLE_IAP' || s.source === 'GOOGLE_PLAY',
    ),
  );

  protected async exportData(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const data = await this.account.exportData();
      saveJson(data, `codify-data-${data.exportedAt.slice(0, 10)}.json`);
      this.telemetry.track('data_export_downloaded');
      this.toast.show({
        message: 'student.privacy.export.done',
        kind: 'success',
      });
    } catch (err) {
      if (
        err instanceof ProblemDetailsError &&
        err.code === EXPORT_RATE_LIMITED
      ) {
        const secs = Number(err.data?.['retryAfter'] ?? 600);
        this.toast.show({
          message: 'student.privacy.export.rateLimited',
          kind: 'warning',
          params: { minutes: Math.max(1, Math.ceil(secs / 60)) },
        });
      } else {
        this.toast.error(err);
      }
    } finally {
      this.exporting.set(false);
    }
  }

  protected openConfirm(): void {
    this.acknowledged.set(false);
    this.confirmOpen.set(true);
    this.telemetry.track('account_delete_opened');
    void this.billing
      .mySubscription()
      .then((r) => this.subscriptions.set(r.subscriptions))
      .catch(() => this.subscriptions.set([]));
  }

  protected async deleteAccount(): Promise<void> {
    if (!this.acknowledged() || this.deleting()) return;
    this.deleting.set(true);
    try {
      const result = await this.account.deleteAccount();
      this.telemetry.track('account_deleted', {
        storeSubscriptions: result.storeSubscriptions.length,
      });
      this.state.deleted(result);
      this.confirmOpen.set(false);
      await this.router.navigateByUrl(RESTORE_PATH);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.deleting.set(false);
    }
  }
}

/** Offer `data` as a JSON file download (web + Capacitor web view). */
function saveJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
