import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import {
  MeClient,
  NotificationsClient,
  type KindPreference,
  type NotificationKind,
} from '@codify/api-client';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppCard,
  AppSelect,
  AppSkeleton,
  AppToggle,
  ErrorState,
  Icon,
  OfflineState,
  type AppSelectOption,
} from '@codify/ui-ionic';
import { NetworkStatusService } from '../../offline/network-status.service.js';
import { AppToastService } from '../../platform/app-toast.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { KIND_ICONS } from './notification-actions.js';
import {
  MAX_DAILY_CAP,
  cloneForm,
  diffForm,
  toForm,
  type PrefsForm,
} from './prefs-form.js';

/** One-off kinds that make no sense to toggle afterwards. */
const HIDDEN_KINDS: ReadonlySet<NotificationKind> = new Set(['WELCOME']);

/**
 * Settings → Notifications (docs/05 Settings, docs/10 §3): per-kind push /
 * email toggles (SYSTEM + BILLING shown locked with the reason), "fewer
 * like this" reset, daily-quest reminder time, daily push cap, the
 * 14-per-week opt-in and quiet hours (PATCH /me).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppButton,
    AppCard,
    AppSelect,
    AppSkeleton,
    AppToggle,
    ErrorState,
    Icon,
    OfflineState,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/profile" />
        </ion-buttons>
        <ion-title>{{
          'student.notifications.prefs.title' | translate
        }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="ns">
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="160" />
          <cdf-app-skeleton shape="rect" [height]="120" />
        } @else if (!form()) {
          @if (!online()) {
            <cdf-offline-state
              data-testid="prefs-offline"
              [title]="'student.notifications.offlineTitle' | translate"
              [description]="'student.notifications.prefs.offline' | translate"
              (retry)="load()"
            />
          } @else {
            <cdf-error-state
              [title]="'student.notifications.prefs.loadError' | translate"
              (retry)="load()"
            />
          }
        } @else {
          @let f = form()!;
          <form class="ns__form" (submit)="save($event)">
            <cdf-app-card padding="normal">
              <h2 id="ns-kinds">
                {{ 'student.notifications.prefs.kindsTitle' | translate }}
              </h2>
              <p class="ns__muted">
                {{ 'student.notifications.prefs.kindsIntro' | translate }}
              </p>
              <ul class="ns__kinds" aria-labelledby="ns-kinds">
                @for (k of visibleKinds(); track k.kind) {
                  <li
                    class="ns__kind"
                    data-testid="kind-row"
                    [attr.data-kind]="k.kind"
                  >
                    <div class="ns__kindhead">
                      <cdf-icon [name]="icon(k.kind)" size="md" />
                      <div>
                        <strong>{{
                          'student.notifications.kinds.' + k.kind | translate
                        }}</strong>
                        <small>{{
                          'student.notifications.kindHints.' + k.kind
                            | translate
                        }}</small>
                      </div>
                    </div>
                    <div class="ns__toggles">
                      @if (k.channels.push) {
                        <cdf-app-toggle
                          [label]="
                            'student.notifications.prefs.push' | translate
                          "
                          [name]="'push-' + k.kind"
                          [ngModel]="k.pushEnabled"
                          (ngModelChange)="setKind(k.kind, 'push', $event)"
                          [disabled]="k.locked"
                          [attr.data-testid]="'push-' + k.kind"
                        />
                      }
                      @if (k.channels.email) {
                        <cdf-app-toggle
                          [label]="
                            'student.notifications.prefs.email' | translate
                          "
                          [name]="'email-' + k.kind"
                          [ngModel]="k.emailEnabled"
                          (ngModelChange)="setKind(k.kind, 'email', $event)"
                          [disabled]="k.locked"
                          [attr.data-testid]="'email-' + k.kind"
                        />
                      }
                    </div>
                    @if (k.locked) {
                      <p class="ns__locked">
                        <cdf-icon name="lock" size="xs" />
                        {{ 'student.notifications.prefs.locked' | translate }}
                      </p>
                    } @else if (k.fewerLevel > 0) {
                      <p class="ns__fewer">
                        {{
                          (k.fewerLevel >= 2
                            ? 'student.notifications.prefs.fewer2'
                            : 'student.notifications.prefs.fewer1'
                          ) | translate
                        }}
                        <button
                          type="button"
                          class="ns__link"
                          (click)="resetFewer(k.kind)"
                        >
                          {{
                            'student.notifications.prefs.resetFewer' | translate
                          }}
                        </button>
                      </p>
                    }
                  </li>
                }
              </ul>
            </cdf-app-card>

            <cdf-app-card padding="normal">
              <h2>
                {{ 'student.notifications.prefs.reminderTitle' | translate }}
              </h2>
              <fieldset class="ns__fieldset">
                <legend class="ns__muted">
                  {{ 'student.notifications.prefs.reminderLegend' | translate }}
                </legend>
                <label class="ns__radio">
                  <input
                    type="radio"
                    name="reminderMode"
                    value="auto"
                    [ngModel]="f.reminderMode"
                    (ngModelChange)="patch({ reminderMode: $event })"
                    data-testid="reminder-auto"
                  />
                  {{ 'student.notifications.prefs.reminderAuto' | translate }}
                </label>
                <label class="ns__radio">
                  <input
                    type="radio"
                    name="reminderMode"
                    value="custom"
                    [ngModel]="f.reminderMode"
                    (ngModelChange)="patch({ reminderMode: $event })"
                    data-testid="reminder-custom"
                  />
                  {{ 'student.notifications.prefs.reminderCustom' | translate }}
                </label>
                @if (f.reminderMode === 'custom') {
                  <label class="ns__time">
                    <span>{{
                      'student.notifications.prefs.reminderTime' | translate
                    }}</span>
                    <input
                      type="time"
                      name="reminderTime"
                      required
                      [ngModel]="f.reminderTime"
                      (ngModelChange)="patch({ reminderTime: $event })"
                      data-testid="reminder-time"
                    />
                  </label>
                }
              </fieldset>
            </cdf-app-card>

            <cdf-app-card padding="normal">
              <h2>
                {{ 'student.notifications.prefs.limitsTitle' | translate }}
              </h2>
              <div class="ns__row">
                <span id="ns-cap">{{
                  'student.notifications.prefs.capLabel' | translate
                }}</span>
                <cdf-app-select
                  name="dailyCap"
                  [options]="capOptions()"
                  [ngModel]="f.dailyCap"
                  (ngModelChange)="patch({ dailyCap: $event })"
                  [ariaLabel]="
                    'student.notifications.prefs.capLabel' | translate
                  "
                  data-testid="daily-cap"
                />
              </div>
              <cdf-app-toggle
                name="weeklyOptIn"
                [label]="'student.notifications.prefs.weeklyOptIn' | translate"
                [ngModel]="f.weeklyOptIn"
                (ngModelChange)="patch({ weeklyOptIn: $event })"
                data-testid="weekly-opt-in"
              />
              <p class="ns__muted">
                {{ 'student.notifications.prefs.weeklyHint' | translate }}
              </p>
            </cdf-app-card>

            <cdf-app-card padding="normal">
              <h2>
                {{ 'student.notifications.prefs.quietTitle' | translate }}
              </h2>
              <p class="ns__muted">
                {{ 'student.notifications.prefs.quietHint' | translate }}
              </p>
              <div class="ns__times">
                <label class="ns__time">
                  <span>{{
                    'student.notifications.prefs.quietStart' | translate
                  }}</span>
                  <input
                    type="time"
                    name="quietStart"
                    required
                    [ngModel]="f.quietStart"
                    (ngModelChange)="patch({ quietStart: $event })"
                    data-testid="quiet-start"
                  />
                </label>
                <label class="ns__time">
                  <span>{{
                    'student.notifications.prefs.quietEnd' | translate
                  }}</span>
                  <input
                    type="time"
                    name="quietEnd"
                    required
                    [ngModel]="f.quietEnd"
                    (ngModelChange)="patch({ quietEnd: $event })"
                    data-testid="quiet-end"
                  />
                </label>
              </div>
            </cdf-app-card>

            <div class="ns__actions">
              @if (changes().invalid) {
                <p class="ns__error" role="alert">
                  {{ 'student.notifications.prefs.invalid' | translate }}
                </p>
              }
              <cdf-app-button
                kind="primary"
                type="submit"
                [loading]="saving()"
                [disabled]="!dirty() || changes().invalid || !online()"
                data-testid="prefs-save"
              >
                {{ 'student.notifications.prefs.save' | translate }}
              </cdf-app-button>
            </div>
          </form>
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .ns {
        max-width: 720px;
        margin: 0 auto;
      }
      .ns__form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      h2 {
        font-size: 17px;
        margin: 0 0 6px;
      }
      .ns__muted {
        margin: 0 0 8px;
        font-size: 14px;
        color: var(--cdf-color-text-muted, #4b5563);
      }
      .ns__kinds {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .ns__kind {
        padding: 12px 0;
        border-top: 1px solid var(--cdf-color-border, #e5e7eb);
      }
      .ns__kindhead {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .ns__kindhead > div {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .ns__kindhead small {
        color: var(--cdf-color-text-muted, #4b5563);
        font-size: 13px;
      }
      .ns__toggles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0 16px;
        padding-inline-start: 36px;
      }
      .ns__locked,
      .ns__fewer {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin: 4px 0 0;
        padding-inline-start: 36px;
        font-size: 13px;
        color: var(--cdf-color-text-muted, #4b5563);
      }
      .ns__link {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-weight: 600;
        color: var(--cdf-color-primary, #2563eb);
        text-decoration: underline;
        cursor: pointer;
      }
      .ns__fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ns__radio {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
      }
      .ns__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .ns__times {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .ns__time {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 14px;
      }
      .ns__time input {
        min-height: 40px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid var(--cdf-color-border, #d1d5db);
        background: var(--cdf-color-surface-elev, #fff);
        color: inherit;
        font: inherit;
      }
      .ns__time input:focus-visible,
      .ns__radio input:focus-visible,
      .ns__link:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      .ns__actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        flex-wrap: wrap;
        padding-bottom: 24px;
      }
      .ns__error {
        margin: 0;
        color: var(--cdf-color-danger, #dc2626);
        font-size: 14px;
      }
    `,
  ],
})
export class NotificationSettingsPage {
  private readonly client = inject(NotificationsClient);
  private readonly me = inject(MeClient);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly network = inject(NetworkStatusService);

  protected readonly online = this.network.online;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  private readonly original = signal<PrefsForm | null>(null);
  protected readonly form = signal<PrefsForm | null>(null);

  protected readonly visibleKinds = computed(() =>
    (this.form()?.kinds ?? []).filter((k) => !HIDDEN_KINDS.has(k.kind)),
  );
  protected readonly changes = computed(() => {
    const o = this.original();
    const f = this.form();
    return o && f
      ? diffForm(o, f)
      : { prefs: null, me: null, changedKinds: [], invalid: false };
  });
  protected readonly dirty = computed(
    () => !!this.changes().prefs || !!this.changes().me,
  );
  protected readonly capOptions = computed<AppSelectOption<string>[]>(() => {
    this.i18n.currentLocale();
    return [
      {
        value: 'default',
        label: this.i18n.t('student.notifications.prefs.capDefault'),
      },
      { value: '0', label: this.i18n.t('student.notifications.prefs.capNone') },
      ...Array.from({ length: MAX_DAILY_CAP }, (_, i) => ({
        value: String(i + 1),
        label: this.i18n.t('student.notifications.prefs.capN', {
          count: i + 1,
        }),
      })),
    ];
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [prefs, me] = await Promise.all([
        this.client.preferences(),
        this.me.me(),
      ]);
      const form = toForm(prefs, me);
      this.original.set(form);
      this.form.set(cloneForm(form));
    } catch {
      this.form.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected icon(kind: NotificationKind) {
    return KIND_ICONS[kind];
  }

  protected patch(change: Partial<PrefsForm>): void {
    this.form.update((f) => (f ? { ...f, ...change } : f));
  }

  protected setKind(
    kind: NotificationKind,
    channel: 'push' | 'email',
    enabled: boolean,
  ): void {
    this.updateKind(kind, (k) =>
      channel === 'push'
        ? { ...k, pushEnabled: enabled }
        : { ...k, emailEnabled: enabled },
    );
  }

  protected resetFewer(kind: NotificationKind): void {
    this.updateKind(kind, (k) => ({ ...k, fewerLevel: 0 }));
  }

  private updateKind(
    kind: NotificationKind,
    fn: (k: KindPreference) => KindPreference,
  ): void {
    this.form.update((f) =>
      f
        ? { ...f, kinds: f.kinds.map((k) => (k.kind === kind ? fn(k) : k)) }
        : f,
    );
  }

  protected async save(event?: Event): Promise<void> {
    event?.preventDefault();
    const c = this.changes();
    if (c.invalid || (!c.prefs && !c.me) || this.saving()) return;
    this.saving.set(true);
    try {
      const [prefs, me] = await Promise.all([
        c.prefs
          ? this.client.updatePreferences(c.prefs)
          : this.client.preferences(),
        c.me ? this.me.update(c.me) : this.me.me(),
      ]);
      for (const k of c.changedKinds) {
        this.telemetry.track('notification_settings_changed', {
          kind: k.kind,
          channel: k.channel,
          enabled: k.enabled,
        });
      }
      const fields = [
        ...(c.prefs ? Object.keys(c.prefs).filter((f) => f !== 'kinds') : []),
        ...(c.me ? ['quietHours'] : []),
      ];
      if (fields.length > 0) {
        this.telemetry.track('notification_settings_changed', {
          fields: fields.join(','),
        });
      }
      const form = toForm(prefs, me);
      this.original.set(form);
      this.form.set(cloneForm(form));
      this.toast.show({
        message: 'student.notifications.prefs.saved',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }
}
