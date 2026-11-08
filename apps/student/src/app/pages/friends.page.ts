import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppAvatar,
  AppButton,
  AppCard,
  AppInput,
  AppSkeleton,
  AppToggle,
  BottomSheet,
  EmptyState,
  FormField,
  Icon,
  LevelBadge,
} from '@codify/ui-ionic';
import {
  LeaguesClient,
  MeClient,
  ProblemDetailsError,
  type CompareStats,
  type Friend,
  type FriendCompare,
  type FriendInvite,
  type FriendRequest,
} from '@codify/api-client';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { FriendsActivityComponent } from '../components/friends-activity.component.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { shareLink } from './shared/share.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rows of the compare card (docs/05 Friends "mini side-by-side stats"). */
const COMPARE_ROWS: (keyof CompareStats)[] = [
  'level',
  'totalXp',
  'weeklyXp',
  'streakDays',
  'longestStreak',
  'lessonsCompleted',
  'coursesCompleted',
  'badges',
];

/**
 * Friends (docs/05 Friends, docs/10 §5): share an invite link, add by
 * email, answer requests, nudge (rate-limited server-side), compare stats
 * side by side, open public profiles, opt in to sharing your activity and
 * see opted-in friends' recent activity.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppAvatar,
    AppButton,
    AppCard,
    AppInput,
    AppSkeleton,
    AppToggle,
    BottomSheet,
    EmptyState,
    FormField,
    FriendsActivityComponent,
    Icon,
    LevelBadge,
    LocalePipe,
    OfflineGate,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/profile" />
        </ion-buttons>
        <ion-title>{{ 'student.friends.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="fr">
        <cdf-offline-gate capability="social">
          <!-- Invite link -->
          <cdf-app-card padding="normal" data-testid="invite-card">
            <h2>{{ 'student.friends.inviteTitle' | translate }}</h2>
            <p class="fr__muted">
              {{ 'student.friends.inviteBody' | translate }}
            </p>
            @if (invite(); as inv) {
              <div class="fr__invite">
                <code class="fr__link" data-testid="invite-link">{{
                  inv.url
                }}</code>
                <cdf-app-button
                  kind="primary"
                  size="sm"
                  (buttonClick)="shareInvite(inv)"
                  data-testid="share-invite"
                >
                  <cdf-icon name="share" size="sm" />
                  {{ 'student.friends.share' | translate }}
                </cdf-app-button>
              </div>
            } @else {
              <cdf-app-skeleton shape="text" />
            }
          </cdf-app-card>

          <!-- Add by email -->
          <cdf-app-card padding="normal">
            <h2>{{ 'student.friends.addTitle' | translate }}</h2>
            <form class="fr__add" (submit)="add($event)">
              <cdf-form-field
                [label]="'student.friends.emailLabel' | translate"
                class="fr__field"
              >
                <cdf-app-input
                  type="email"
                  name="email"
                  [(ngModel)]="email"
                  [placeholder]="'student.friends.emailPlaceholder' | translate"
                  data-testid="friend-email"
                />
              </cdf-form-field>
              <cdf-app-button
                kind="primary"
                size="sm"
                type="submit"
                [loading]="sending()"
                data-testid="add-friend-btn"
              >
                {{ 'student.friends.send' | translate }}
              </cdf-app-button>
            </form>
          </cdf-app-card>

          <!-- Activity sharing (opt-in) -->
          <cdf-app-card padding="normal" data-testid="activity-optin-card">
            <cdf-app-toggle
              [label]="'student.friends.activity.optIn' | translate"
              [ngModel]="activityOptIn()"
              (ngModelChange)="setActivityOptIn($event)"
              [disabled]="activityOptIn() === null || savingOptIn()"
              data-testid="activity-optin"
            />
            <p class="fr__muted">
              {{ 'student.friends.activity.optInHint' | translate }}
            </p>
          </cdf-app-card>

          <cdf-friends-activity [limit]="10" />

          <!-- Incoming requests -->
          @if (requests().length > 0) {
            <h2 class="fr__section">
              {{ 'student.friends.requests' | translate }}
            </h2>
            <ul class="fr__list" data-testid="requests-list">
              @for (r of requests(); track r.id) {
                <li class="fr__row">
                  <cdf-app-avatar [name]="r.senderName" size="sm" />
                  <span class="fr__name">{{ r.senderName }}</span>
                  <cdf-app-button
                    kind="primary"
                    size="sm"
                    [ariaLabel]="
                      'student.friends.acceptNamed'
                        | translate: { name: r.senderName }
                    "
                    (buttonClick)="respond(r, true)"
                    data-testid="accept-btn"
                  >
                    {{ 'student.friends.accept' | translate }}
                  </cdf-app-button>
                  <cdf-app-button
                    kind="ghost"
                    size="sm"
                    [ariaLabel]="
                      'student.friends.declineNamed'
                        | translate: { name: r.senderName }
                    "
                    (buttonClick)="respond(r, false)"
                  >
                    {{ 'student.friends.decline' | translate }}
                  </cdf-app-button>
                </li>
              }
            </ul>
          }

          <!-- Friends -->
          <h2 class="fr__section">
            {{
              'student.friends.yourFriends'
                | translate: { count: friends().length }
            }}
          </h2>
          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="64" />
          } @else if (friends().length === 0) {
            <cdf-empty-state
              icon="person"
              [title]="'student.friends.emptyTitle' | translate"
              [description]="'student.friends.emptyBody' | translate"
            />
          } @else {
            <ul class="fr__list" data-testid="friends-list">
              @for (f of friends(); track f.userId) {
                <li class="fr__row" [attr.data-user-id]="f.userId">
                  <a class="fr__person" [routerLink]="['/u', f.userId]">
                    <cdf-app-avatar [name]="f.displayName" size="sm" />
                    <span class="fr__name">{{ f.displayName }}</span>
                  </a>
                  <cdf-level-badge [level]="f.level" size="sm" />
                  <cdf-app-button
                    kind="ghost"
                    size="sm"
                    [loading]="comparing() === f.userId"
                    [ariaLabel]="
                      'student.friends.compareNamed'
                        | translate: { name: f.displayName }
                    "
                    (buttonClick)="compare(f)"
                    data-testid="compare-btn"
                  >
                    <cdf-icon name="podium" size="sm" />
                    {{ 'student.friends.compare' | translate }}
                  </cdf-app-button>
                  <cdf-app-button
                    kind="secondary"
                    size="sm"
                    [loading]="nudging() === f.userId"
                    [disabled]="nudged().has(f.userId)"
                    [ariaLabel]="
                      'student.friends.nudgeNamed'
                        | translate: { name: f.displayName }
                    "
                    (buttonClick)="nudge(f)"
                    data-testid="nudge-btn"
                  >
                    <cdf-icon name="notifications" size="sm" />
                    {{
                      (nudged().has(f.userId)
                        ? 'student.friends.nudged'
                        : 'student.friends.nudge'
                      ) | translate
                    }}
                  </cdf-app-button>
                </li>
              }
            </ul>
          }
        </cdf-offline-gate>
      </div>

      @if (comparison(); as c) {
        <cdf-bottom-sheet
          [open]="compareOpen()"
          (openChange)="compareOpen.set($event)"
          [title]="
            'student.friends.compareTitle'
              | translate: { name: c.friend.displayName }
          "
        >
          <table class="fr__compare" data-testid="compare-table">
            <caption class="fr__sr">
              {{
                'student.friends.compareCaption'
                  | translate: { name: c.friend.displayName }
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span class="fr__sr">{{
                    'student.friends.compareStat' | translate
                  }}</span>
                </th>
                <th scope="col">
                  {{ 'student.friends.compareYou' | translate }}
                </th>
                <th scope="col">{{ c.friend.displayName }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of compareRows; track row) {
                <tr>
                  <th scope="row">
                    {{ 'student.friends.stats.' + row | translate }}
                  </th>
                  <td
                    [class.fr__lead]="+c.me[row] > +c.friend[row]"
                    [attr.data-stat]="row"
                  >
                    {{ c.me[row] | locale: 'number' }}
                  </td>
                  <td [class.fr__lead]="+c.friend[row] > +c.me[row]">
                    {{ c.friend[row] | locale: 'number' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </cdf-bottom-sheet>
      }
    </ion-content>
  `,
  styles: [
    `
      .fr {
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      h2 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .fr__section {
        margin: var(--cdf-space-2) 0 0;
      }
      .fr__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0 0 var(--cdf-space-2);
      }
      .fr__invite {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .fr__link {
        flex: 1 1 200px;
        font-size: 13px;
        word-break: break-all;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.04));
        padding: 6px 8px;
        border-radius: 8px;
      }
      .fr__add {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .fr__field {
        flex: 1 1 220px;
      }
      .fr__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-1);
      }
      .fr__row {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2);
        border-radius: 12px;
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
      }
      .fr__person {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        color: inherit;
        text-decoration: none;
        min-width: 0;
        border-radius: 8px;
      }
      .fr__person:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .fr__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .fr__compare {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--cdf-font-size-sm);
      }
      .fr__compare th,
      .fr__compare td {
        padding: 8px 6px;
        border-bottom: 1px solid var(--cdf-color-border);
        text-align: right;
      }
      .fr__compare th[scope='row'],
      .fr__compare thead th:first-child {
        text-align: left;
        font-weight: 500;
        color: var(--cdf-color-text-muted);
      }
      .fr__compare thead th {
        font-weight: 700;
      }
      .fr__lead {
        font-weight: 700;
        color: var(--cdf-color-success, inherit);
      }
      .fr__row {
        flex-wrap: wrap;
      }
      .fr__name {
        flex: 1;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class FriendsPage {
  private readonly client = inject(LeaguesClient);
  private readonly me = inject(MeClient);
  private readonly toast = inject(AppToastService);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);

  protected email = '';
  protected readonly loading = signal(true);
  protected readonly sending = signal(false);
  protected readonly nudging = signal<string | null>(null);
  protected readonly nudged = signal<Set<string>>(new Set());
  protected readonly friends = signal<Friend[]>([]);
  protected readonly requests = signal<FriendRequest[]>([]);
  protected readonly invite = signal<FriendInvite | null>(null);
  protected readonly compareRows = COMPARE_ROWS;
  protected readonly comparing = signal<string | null>(null);
  protected readonly comparison = signal<FriendCompare | null>(null);
  protected readonly compareOpen = signal(false);
  /** Null until /me loads. */
  protected readonly activityOptIn = signal<boolean | null>(null);
  protected readonly savingOptIn = signal(false);

  constructor() {
    void this.refresh();
    void this.loadInvite();
    void this.loadOptIn();
  }

  private async loadOptIn(): Promise<void> {
    try {
      this.activityOptIn.set((await this.me.me()).activityFeedOptIn ?? false);
    } catch {
      this.activityOptIn.set(null);
    }
  }

  protected async setActivityOptIn(on: boolean): Promise<void> {
    if (on === this.activityOptIn()) return;
    const previous = this.activityOptIn();
    this.activityOptIn.set(on);
    this.savingOptIn.set(true);
    try {
      const me = await this.me.update({ activityFeedOptIn: on });
      this.activityOptIn.set(me.activityFeedOptIn ?? on);
      this.telemetry.track('activity_feed_opt_in', { optIn: on });
    } catch (err) {
      this.activityOptIn.set(previous);
      this.toast.error(err);
    } finally {
      this.savingOptIn.set(false);
    }
  }

  protected async compare(f: Friend): Promise<void> {
    this.comparing.set(f.userId);
    try {
      this.comparison.set(await this.client.compare(f.userId));
      this.compareOpen.set(true);
      this.telemetry.track('friend_compare_viewed');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.comparing.set(null);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const [friends, requests] = await Promise.all([
        this.client.friends(),
        this.client.friendRequests(),
      ]);
      this.friends.set(friends);
      this.requests.set(requests);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadInvite(): Promise<void> {
    try {
      this.invite.set(await this.client.friendInvite());
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async shareInvite(inv: FriendInvite): Promise<void> {
    const outcome = await shareLink({
      title: this.i18n.t('student.friends.shareTitle'),
      text: this.i18n.t('student.friends.shareText'),
      url: inv.url,
    });
    if (outcome === 'shared' || outcome === 'copied') {
      this.telemetry.track('friend_invite_shared', {
        channel: outcome === 'shared' ? 'share_sheet' : 'clipboard',
      });
    }
    if (outcome === 'copied') {
      this.toast.show({ message: 'student.friends.copied', kind: 'success' });
    } else if (outcome === 'failed') {
      this.toast.show({
        message: 'student.friends.shareFailed',
        kind: 'warning',
      });
    }
  }

  protected async add(ev?: Event): Promise<void> {
    ev?.preventDefault();
    const email = this.email.trim();
    if (!EMAIL_RE.test(email)) {
      this.toast.show({
        message: 'student.friends.invalidEmail',
        kind: 'warning',
      });
      return;
    }
    this.sending.set(true);
    try {
      await this.client.sendFriendRequest(email);
      this.telemetry.track('friend_request_sent');
      // The API never reveals whether the address has an account.
      this.toast.show({
        message: 'student.friends.requestSent',
        kind: 'success',
        params: { email },
      });
      this.email = '';
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 400) {
        this.toast.show({
          message: 'student.friends.cannotAddSelf',
          kind: 'warning',
        });
      } else {
        this.toast.error(err);
      }
    } finally {
      this.sending.set(false);
    }
  }

  protected async respond(r: FriendRequest, accept: boolean): Promise<void> {
    try {
      await this.client.respondRequest(r.id, accept);
      this.requests.update((rs) => rs.filter((x) => x.id !== r.id));
      if (accept) {
        this.telemetry.track('friend_request_accepted');
        this.toast.show({
          message: 'student.friends.accepted',
          kind: 'success',
          params: { name: r.senderName },
        });
        await this.refresh();
      }
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async nudge(f: Friend): Promise<void> {
    this.nudging.set(f.userId);
    try {
      const res = await this.client.nudge(f.userId);
      this.telemetry.track('friend_nudge_sent', {
        pushed: res.pushed ?? false,
      });
      this.markNudged(f.userId);
      this.toast.show({
        message:
          res.pushed === false
            ? 'student.friends.nudgeQueued'
            : 'student.friends.nudgeSent',
        kind: 'success',
        params: { name: f.displayName },
      });
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 409) {
        this.markNudged(f.userId);
        this.toast.show({
          message: 'student.friends.nudgeTooSoon',
          kind: 'info',
          params: { name: f.displayName },
        });
      } else {
        this.toast.error(err);
      }
    } finally {
      this.nudging.set(null);
    }
  }

  private markNudged(id: string): void {
    this.nudged.update((s) => new Set(s).add(id));
  }
}
