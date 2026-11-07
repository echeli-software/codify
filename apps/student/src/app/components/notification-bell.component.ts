import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import { NotificationsStore } from '../pages/notifications/notifications.store.js';

/**
 * Notifications bell (docs/05 §1: top-right on desktop, Today header on
 * mobile) with the unread count; opens the inbox. `only` hides it on the
 * other layout so both placements can coexist without double bells.
 */
@Component({
  selector: 'cdf-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe, LocalePipe],
  host: {
    '[class.bell--desktop-only]': "only() === 'desktop'",
    '[class.bell--mobile-only]': "only() === 'mobile'",
  },
  template: `
    <a
      class="bell"
      routerLink="/notifications"
      data-testid="notification-bell"
      [attr.aria-label]="
        unread() > 0
          ? ('student.notifications.bellUnread'
            | translate: { count: unread() })
          : ('student.notifications.bell' | translate)
      "
    >
      <cdf-icon name="notifications" size="md" />
      @if (unread() > 0) {
        <span class="bell__count" aria-hidden="true" data-testid="bell-count"
          >{{ badge() | locale: 'integer' }}{{ unread() > 99 ? '+' : '' }}</span
        >
      }
    </a>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      @media (min-width: 768px) {
        :host(.bell--mobile-only) {
          display: none;
        }
      }
      @media (max-width: 767.98px) {
        :host(.bell--desktop-only) {
          display: none;
        }
      }
      .bell {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        color: inherit;
        text-decoration: none;
      }
      .bell:hover {
        background: var(--cdf-color-primary-subtle, #eef2ff);
      }
      .bell:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      .bell__count {
        position: absolute;
        top: 2px;
        right: 0;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--cdf-color-danger, #dc2626);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        line-height: 18px;
        text-align: center;
        box-sizing: border-box;
      }
    `,
  ],
})
export class NotificationBell {
  /** Show only on one layout (desktop shell vs. mobile Today header). */
  readonly only = input<'desktop' | 'mobile' | null>(null);

  private readonly store = inject(NotificationsStore);
  protected readonly unread = this.store.unread;
  protected readonly badge = computed(() => Math.min(99, this.unread()));

  constructor() {
    this.store.start();
  }
}
