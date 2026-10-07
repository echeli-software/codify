import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppInput,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';
import {
  LeaguesClient,
  ProblemDetailsError,
  type Friend,
  type FriendRequest,
} from '@codify/api-client';

/**
 * Friends MVP — add by email, accept/reject incoming requests, and nudge a
 * friend (rate-limited server-side to once per 24h). Tap a friend to view
 * their public profile.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppBadge,
    AppButton,
    AppCard,
    AppInput,
    EmptyState,
    Icon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Friends</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Add friend -->
      <cdf-app-card padding="normal">
        <h3>Add a friend</h3>
        <div class="add">
          <cdf-app-input
            [(ngModel)]="email"
            placeholder="friend@email.com"
            data-testid="friend-email"
          />
          <cdf-app-button
            kind="primary"
            size="sm"
            [loading]="sending()"
            (buttonClick)="add()"
            data-testid="add-friend-btn"
            >Send</cdf-app-button
          >
        </div>
        @if (message(); as m) {
          <p class="msg" [class.msg--err]="isError()">{{ m }}</p>
        }
      </cdf-app-card>

      <!-- Incoming requests -->
      @if (requests().length > 0) {
        <h3 class="section">Requests</h3>
        <div class="list" data-testid="requests-list">
          @for (r of requests(); track r.id) {
            <cdf-app-card padding="normal" class="row">
              <span class="row__name">{{ r.senderName }}</span>
              <cdf-app-button
                kind="primary"
                size="sm"
                (buttonClick)="respond(r, true)"
                data-testid="accept-btn"
                >Accept</cdf-app-button
              >
              <cdf-app-button
                kind="ghost"
                size="sm"
                (buttonClick)="respond(r, false)"
                >Decline</cdf-app-button
              >
            </cdf-app-card>
          }
        </div>
      }

      <!-- Friends -->
      <h3 class="section">Your friends ({{ friends().length }})</h3>
      @if (friends().length === 0) {
        <cdf-empty-state
          icon="person"
          title="No friends yet"
          description="Add one by email to compete and cheer each other on."
        />
      } @else {
        <div class="list" data-testid="friends-list">
          @for (f of friends(); track f.userId) {
            <cdf-app-card
              padding="normal"
              class="row"
              [attr.data-user-id]="f.userId"
            >
              <button
                type="button"
                class="row__name row__name--link"
                (click)="openProfile(f.userId)"
              >
                {{ f.displayName }}
              </button>
              <cdf-app-badge variant="neutral" [subtle]="true"
                >Lv {{ f.level }}</cdf-app-badge
              >
              <cdf-app-button
                kind="secondary"
                size="sm"
                (buttonClick)="nudge(f)"
                [attr.data-testid]="'nudge-btn'"
              >
                <cdf-icon name="notifications" size="sm" /> Nudge
              </cdf-app-button>
            </cdf-app-card>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [
    `
      h3 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      h3.section {
        margin-top: var(--cdf-space-4);
      }
      cdf-app-card {
        display: block;
        margin-bottom: var(--cdf-space-2);
      }
      .add {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
      }
      .add cdf-app-input {
        flex: 1;
      }
      .msg {
        font-size: 13px;
        margin: var(--cdf-space-2) 0 0;
        color: var(--cdf-color-success, #2e9e5b);
      }
      .msg--err {
        color: var(--cdf-color-danger, #d0454c);
      }
      .list {
        display: flex;
        flex-direction: column;
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .row__name {
        flex: 1;
        font-weight: 600;
      }
      .row__name--link {
        background: none;
        border: 0;
        padding: 0;
        text-align: left;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
    `,
  ],
})
export class FriendsPage {
  private readonly client = inject(LeaguesClient);
  private readonly router = inject(Router);

  protected email = '';
  protected readonly sending = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);
  protected readonly friends = signal<Friend[]>([]);
  protected readonly requests = signal<FriendRequest[]>([]);

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [friends, requests] = await Promise.all([
        this.client.friends(),
        this.client.friendRequests(),
      ]);
      this.friends.set(friends);
      this.requests.set(requests);
    } catch {
      /* offline — leave as is */
    }
  }

  protected async add(): Promise<void> {
    const email = this.email.trim();
    if (!email) return;
    this.sending.set(true);
    this.message.set(null);
    try {
      const res = await this.client.sendFriendRequest(email);
      this.isError.set(false);
      this.message.set(
        res.status === 'sent' ? 'Request sent!' : 'Request already pending.',
      );
      this.email = '';
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.describe(err));
    } finally {
      this.sending.set(false);
    }
  }

  protected async respond(r: FriendRequest, accept: boolean): Promise<void> {
    try {
      await this.client.respondRequest(r.id, accept);
      this.requests.update((rs) => rs.filter((x) => x.id !== r.id));
      if (accept) await this.refresh();
    } catch {
      /* surfaced by interceptor */
    }
  }

  protected async nudge(f: Friend): Promise<void> {
    this.message.set(null);
    try {
      await this.client.nudge(f.userId);
      this.isError.set(false);
      this.message.set(`Nudged ${f.displayName}!`);
    } catch (err) {
      this.isError.set(true);
      this.message.set(
        err instanceof ProblemDetailsError && err.status === 409
          ? 'You already nudged them recently.'
          : this.describe(err),
      );
    }
  }

  protected openProfile(userId: string): void {
    void this.router.navigate(['/u', userId]);
  }

  private describe(err: unknown): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isNotFound) return 'No user with that email.';
      if (err.status === 409) return 'Already friends or pending.';
      if (err.status === 400) return err.message || 'Invalid request.';
      if (err.message) return err.message;
    }
    return 'Something went wrong.';
  }
}
