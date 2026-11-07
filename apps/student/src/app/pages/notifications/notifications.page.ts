import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import {
  LeaguesClient,
  ProblemDetailsError,
  type InboxNotification,
} from '@codify/api-client';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppSkeleton,
  EmptyState,
  ErrorState,
  Icon,
  OfflineState,
  type IconName,
} from '@codify/ui-ionic';
import { NetworkStatusService } from '../../offline/network-status.service.js';
import { AppToastService } from '../../platform/app-toast.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { groupByDay } from './inbox-grouping.js';
import {
  KIND_ICONS,
  LOCKED_KINDS,
  openRoute,
  quickAction,
  type QuickAction,
} from './notification-actions.js';
import { NotificationsStore } from './notifications.store.js';

/**
 * Notifications inbox (docs/05 "Notifications inbox"): the in-app feed
 * grouped by local day, read / unread styling, mark one / all read, the
 * per-notification quick action (open daily quests, send back a nudge,
 * open the league / subscription…) and "fewer like this". Offline it shows
 * the inbox saved on the device, or an offline state.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppButton,
    AppSkeleton,
    EmptyState,
    ErrorState,
    Icon,
    OfflineState,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/today" />
        </ion-buttons>
        <ion-title>{{ 'student.notifications.title' | translate }}</ion-title>
        <ion-buttons slot="end">
          <a
            class="nt__settings"
            routerLink="/settings/notifications"
            data-testid="inbox-settings-link"
            [attr.aria-label]="'student.notifications.settings' | translate"
          >
            <cdf-icon name="settings" size="md" />
          </a>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="nt">
        @if (store.fromCache()) {
          <p
            class="nt__banner"
            role="status"
            data-testid="inbox-offline-banner"
          >
            <cdf-icon name="cloud-offline" size="sm" />
            {{ 'student.notifications.offlineCached' | translate }}
          </p>
        }

        @if (store.loaded() && store.items().length > 0) {
          <div class="nt__bar">
            <p class="nt__summary" aria-live="polite">
              {{
                store.unread() > 0
                  ? ('student.notifications.unreadCount'
                    | translate: { count: store.unread() })
                  : ('student.notifications.allRead' | translate)
              }}
            </p>
            <cdf-app-button
              kind="ghost"
              size="sm"
              [disabled]="store.unread() === 0 || !online()"
              (buttonClick)="markAll()"
              data-testid="mark-all-read"
            >
              {{ 'student.notifications.markAllRead' | translate }}
            </cdf-app-button>
          </div>
        }

        @if (store.loading() && !store.loaded()) {
          <cdf-app-skeleton shape="rect" [height]="72" />
          <cdf-app-skeleton shape="rect" [height]="72" />
          <cdf-app-skeleton shape="rect" [height]="72" />
        } @else if (store.error()) {
          <cdf-error-state
            [title]="'student.notifications.error' | translate"
            (retry)="reload()"
          />
        } @else if (!store.loaded()) {
          <cdf-offline-state
            data-testid="inbox-offline"
            [title]="'student.notifications.offlineTitle' | translate"
            [description]="'student.notifications.offlineBody' | translate"
            (retry)="reload()"
          />
        } @else if (store.items().length === 0) {
          <cdf-empty-state
            icon="notifications"
            [title]="'student.notifications.emptyTitle' | translate"
            [description]="'student.notifications.emptyBody' | translate"
          />
        } @else {
          @for (g of groups(); track g.day) {
            <section
              class="nt__group"
              [attr.aria-labelledby]="'nt-day-' + g.day"
            >
              <h2 class="nt__day" [id]="'nt-day-' + g.day">
                @switch (g.label) {
                  @case ('today') {
                    {{ 'student.notifications.today' | translate }}
                  }
                  @case ('yesterday') {
                    {{ 'student.notifications.yesterday' | translate }}
                  }
                  @default {
                    {{ g.date | locale: 'date' : 'full' }}
                  }
                }
              </h2>
              <ul class="nt__list">
                @for (n of g.items; track n.id) {
                  <li
                    class="nt__item"
                    [class.nt__item--unread]="!n.readAt"
                    [attr.data-notification-id]="n.id"
                    [attr.data-kind]="n.kind"
                    data-testid="inbox-item"
                  >
                    <span class="nt__icon" aria-hidden="true">
                      <cdf-icon [name]="icon(n)" size="md" />
                    </span>
                    <button
                      type="button"
                      class="nt__main"
                      data-testid="inbox-open"
                      (click)="open(n)"
                    >
                      <span class="nt__title">
                        @if (!n.readAt) {
                          <span class="nt__dot" aria-hidden="true"></span>
                          <span class="nt__sr">{{
                            'student.notifications.unreadLabel' | translate
                          }}</span>
                        }
                        {{ n.title }}
                      </span>
                      <span class="nt__body">{{ n.body }}</span>
                      <time class="nt__time" [attr.datetime]="n.createdAt">{{
                        n.createdAt | locale: 'time'
                      }}</time>
                    </button>
                    <div class="nt__actions">
                      @if (action(n); as a) {
                        <cdf-app-button
                          kind="secondary"
                          size="sm"
                          [disabled]="busy() === n.id"
                          (buttonClick)="runAction(n, a)"
                          data-testid="inbox-action"
                        >
                          {{ a.labelKey | translate }}
                        </cdf-app-button>
                      }
                      @if (!locked(n)) {
                        <cdf-app-button
                          kind="ghost"
                          size="sm"
                          [disabled]="!online()"
                          [ariaLabel]="
                            'student.notifications.fewerNamed'
                              | translate: { title: n.title }
                          "
                          (buttonClick)="fewer(n)"
                          data-testid="inbox-fewer"
                        >
                          {{ 'student.notifications.fewer' | translate }}
                        </cdf-app-button>
                      }
                    </div>
                  </li>
                }
              </ul>
            </section>
          }
          @if (store.hasMore()) {
            <div class="nt__more">
              <cdf-app-button
                kind="secondary"
                [loading]="store.loadingMore()"
                (buttonClick)="loadMore()"
                data-testid="inbox-load-more"
              >
                {{ 'student.notifications.loadMore' | translate }}
              </cdf-app-button>
            </div>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .nt {
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .nt__settings {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        color: inherit;
      }
      .nt__settings:focus-visible,
      .nt__main:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      .nt__banner {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--cdf-color-warning-subtle, #fef3c7);
        color: var(--cdf-color-text, #1f2937);
        font-size: 14px;
      }
      .nt__bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .nt__summary {
        margin: 0;
        font-size: 14px;
        color: var(--cdf-color-text-muted, #4b5563);
      }
      .nt__day {
        margin: 8px 0 6px;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted, #4b5563);
      }
      .nt__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .nt__item {
        display: grid;
        grid-template-columns: 40px 1fr;
        gap: 4px 12px;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--cdf-color-border, #e5e7eb);
        background: var(--cdf-color-surface-elev, #fff);
      }
      .nt__item--unread {
        border-color: var(--cdf-color-primary, #2563eb);
        background: var(--cdf-color-primary-subtle, #eef2ff);
      }
      .nt__icon {
        grid-row: span 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: var(--cdf-color-surface, #f3f4f6);
        color: var(--cdf-color-primary, #2563eb);
      }
      .nt__main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        text-align: start;
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        border-radius: 6px;
      }
      .nt__title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .nt__item--unread .nt__title {
        font-weight: 700;
      }
      .nt__dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--cdf-color-primary, #2563eb);
      }
      .nt__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .nt__body {
        font-size: 14px;
        color: var(--cdf-color-text-muted, #4b5563);
        overflow-wrap: anywhere;
      }
      .nt__time {
        font-size: 12px;
        color: var(--cdf-color-text-muted, #6b7280);
      }
      .nt__actions {
        grid-column: 2;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .nt__actions:empty {
        display: none;
      }
      .nt__more {
        display: flex;
        justify-content: center;
        padding: 8px 0 24px;
      }
    `,
  ],
})
export class NotificationsPage {
  protected readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);
  private readonly leagues = inject(LeaguesClient);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly network = inject(NetworkStatusService);

  protected readonly online = this.network.online;
  protected readonly busy = signal<string | null>(null);
  protected readonly groups = computed(() => groupByDay(this.store.items()));

  constructor() {
    void this.store.load().then(() =>
      this.telemetry.track('notifications_inbox_opened', {
        unread: this.store.unread(),
        count: this.store.items().length,
        fromCache: this.store.fromCache(),
      }),
    );
  }

  protected icon(n: InboxNotification): IconName {
    return KIND_ICONS[n.kind] ?? 'notifications';
  }

  protected action(n: InboxNotification): QuickAction | null {
    return quickAction(n);
  }

  protected locked(n: InboxNotification): boolean {
    return LOCKED_KINDS.has(n.kind);
  }

  protected reload(): void {
    void this.store.load();
  }

  protected loadMore(): void {
    void this.store.loadMore().catch((err) => this.toast.error(err));
  }

  protected async markAll(): Promise<void> {
    try {
      await this.store.markAllRead();
    } catch (err) {
      this.toast.error(err);
    }
  }

  /** Tap on the notification: mark read, then follow its deep link. */
  protected open(n: InboxNotification): void {
    this.telemetry.track('notification_opened', { kind: n.kind, via: 'item' });
    this.markReadQuietly(n);
    const route = openRoute(n);
    if (route) void this.router.navigateByUrl(route);
  }

  protected async runAction(
    n: InboxNotification,
    a: QuickAction,
  ): Promise<void> {
    this.telemetry.track('notification_opened', {
      kind: n.kind,
      via: 'action',
      action: n.action?.type ?? null,
    });
    this.markReadQuietly(n);
    if (a.kind === 'navigate') {
      void this.router.navigateByUrl(a.route);
      return;
    }
    this.busy.set(n.id);
    try {
      const res = await this.leagues.nudge(a.friendId);
      this.telemetry.track('friend_nudge_sent', {
        pushed: res.pushed ?? false,
      });
      this.toast.show({
        message: 'student.notifications.nudgeSent',
        kind: 'success',
      });
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 409) {
        this.toast.show({
          message: 'student.notifications.nudgeAlready',
          kind: 'info',
        });
      } else {
        this.toast.error(err);
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async fewer(n: InboxNotification): Promise<void> {
    try {
      const level = await this.store.fewer(n);
      this.telemetry.track('notification_fewer', { kind: n.kind, level });
      this.toast.show({
        message: 'student.notifications.fewerDone',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    }
  }

  private markReadQuietly(n: InboxNotification): void {
    if (n.readAt || !this.online()) return;
    void this.store.markRead(n).catch(() => undefined);
  }
}
