import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@codify/auth';
import { LeaguesClient, type ActivityFeedEntry } from '@codify/api-client';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import { NetworkStatusService } from '../offline/network-status.service.js';

/**
 * Friends activity (docs/05 Today, docs/10 §5): the latest lesson
 * completions and badges of friends who opted in to sharing. Small and
 * quiet — renders nothing when there is nothing to show (or offline).
 *
 *   <cdf-friends-activity [limit]="5" />
 */
@Component({
  selector: 'cdf-friends-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LocalePipe, TranslatePipe],
  template: `
    @if (entries().length > 0) {
      <section
        class="fa"
        aria-labelledby="fa-title"
        data-testid="friends-activity"
      >
        <div class="fa__head">
          <h2 id="fa-title">
            {{ 'student.friends.activity.title' | translate }}
          </h2>
          <a routerLink="/friends" class="fa__link">{{
            'student.friends.activity.seeFriends' | translate
          }}</a>
        </div>
        <ul class="fa__list">
          @for (e of entries(); track e.id) {
            <li class="fa__item">
              <cdf-icon
                [name]="e.kind === 'BADGE_UNLOCKED' ? 'trophy' : 'check-circle'"
                size="sm"
              />
              <span class="fa__text">
                @if (e.kind === 'BADGE_UNLOCKED') {
                  {{
                    'student.friends.activity.badge'
                      | translate: { name: e.displayName, badge: e.badgeName }
                  }}
                } @else if (e.lessonTitle) {
                  {{
                    'student.friends.activity.lesson'
                      | translate
                        : { name: e.displayName, lesson: e.lessonTitle }
                  }}
                } @else {
                  {{
                    'student.friends.activity.lessonUntitled'
                      | translate: { name: e.displayName }
                  }}
                }
              </span>
              <time class="fa__time" [attr.datetime]="e.at">{{
                e.at | locale: 'relative'
              }}</time>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      .fa__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--cdf-space-2);
      }
      .fa h2 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .fa__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .fa__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .fa__item {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 8px 12px;
        border-radius: 12px;
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        font-size: var(--cdf-font-size-sm);
      }
      .fa__text {
        flex: 1;
        min-width: 0;
      }
      .fa__time {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-xs);
        white-space: nowrap;
      }
    `,
  ],
})
export class FriendsActivityComponent {
  private readonly leagues = inject(LeaguesClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);

  readonly limit = input(5);
  protected readonly entries = signal<ActivityFeedEntry[]>([]);

  constructor() {
    queueMicrotask(() => void this.load());
  }

  private async load(): Promise<void> {
    if (this.auth.role() !== 'STUDENT' || !this.network.online()) return;
    try {
      this.entries.set(await this.leagues.activity(this.limit()));
    } catch {
      // Feature off / offline: the widget simply stays hidden.
      this.entries.set([]);
    }
  }
}
