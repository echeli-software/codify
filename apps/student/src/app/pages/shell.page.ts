import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AuthService } from '@codify/auth';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AppAvatar,
  AppShell,
  BottomSheet,
  Icon,
  type IconName,
  type ShellTab,
} from '@codify/ui-ionic';
import {
  CoinService,
  CoinTarget,
  StreakService,
  StreakTarget,
  XpService,
  XpTarget,
} from '@codify/gamification-engine';
import { RewardOverlays } from '../reward-overlays.component.js';
import { EngagementPrompts } from '../components/engagement-prompts.component.js';
import { NotificationBell } from '../components/notification-bell.component.js';
import { IdentityCacheService } from '../offline/identity-cache.service.js';
import { OfflineIndicator } from '../offline/offline-indicator.component.js';
import { DownloadService } from '../offline/download.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { AppSessionService } from '../platform/app-session.service.js';
import { SignOutConfirm } from '../platform/sign-out-confirm.component.js';
import { StoragePrompt } from '../platform/storage-prompt.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { GlobalSearch } from '../components/global-search.component.js';
import { BirthDateGateComponent } from '../components/birth-date/birth-date-gate.component.js';
import { TimeZoneSync } from '../components/time-zone.js';
import {
  ShellBreadcrumbs,
  type Crumb,
} from '../components/shell-breadcrumbs.service.js';
import {
  FeatureFlagsService,
  type StudentFeature,
} from '../platform/feature-flags.service.js';

interface NavEntry {
  path: string;
  labelKey: string;
  icon: IconName;
  /** Shown in the phone tab bar (max 5); the rest live in "More". */
  primary: boolean;
  /** Hidden while this feature flag is off (docs/04 Settings). */
  feature?: StudentFeature;
}

/** Navigation (docs/05 §1). Paths are app.routes paths. */
export const NAV: readonly NavEntry[] = [
  {
    path: 'today',
    labelKey: 'studentPlatform.nav.today',
    icon: 'home',
    primary: true,
  },
  {
    path: 'catalog',
    labelKey: 'studentPlatform.nav.catalog',
    icon: 'school',
    primary: true,
  },
  {
    path: 'my-courses',
    labelKey: 'studentPlatform.nav.myCourses',
    icon: 'bookmark',
    primary: true,
  },
  {
    path: 'league',
    labelKey: 'studentPlatform.nav.league',
    icon: 'podium',
    primary: true,
    feature: 'leagues.enabled',
  },
  {
    path: 'friends',
    labelKey: 'studentPlatform.nav.friends',
    icon: 'chat',
    primary: false,
    feature: 'friends.enabled',
  },
  {
    path: 'shop',
    labelKey: 'studentPlatform.nav.shop',
    icon: 'cart',
    primary: false,
    feature: 'shop.enabled',
  },
  {
    path: 'avatar',
    labelKey: 'studentPlatform.nav.avatar',
    icon: 'shirt',
    primary: false,
  },
  {
    path: 'profile',
    labelKey: 'studentPlatform.nav.profile',
    icon: 'person',
    primary: true,
  },
  {
    path: 'downloads',
    labelKey: 'studentPlatform.nav.downloads',
    icon: 'download',
    primary: false,
  },
];

const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Authenticated shell: a compact header (avatar + name from the offline
 * identity bundle, level / XP / coins / streak from the reward engine, the
 * offline chip, and a "More" menu on phones), the AppShell tab bar /
 * sidebar, and the app-wide sheets (reward overlays, storage prompt,
 * sign-out confirmation). Counters are reconciled with the server totals
 * by AppSessionService — nothing is seeded here.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CoinTarget,
    XpTarget,
    StreakTarget,
    AppShell,
    AppAvatar,
    BottomSheet,
    Icon,
    RouterLink,
    LocalePipe,
    TranslatePipe,
    RewardOverlays,
    EngagementPrompts,
    OfflineIndicator,
    NotificationBell,
    StoragePrompt,
    SignOutConfirm,
    GlobalSearch,
    BirthDateGateComponent,
  ],
  template: `
    <header class="bar" data-testid="shell-header">
      <button
        type="button"
        class="bar__me"
        data-testid="shell-user"
        [attr.aria-label]="
          'studentPlatform.shell.openAccount'
            | translate: { name: displayName() }
        "
        (click)="openAccount()"
      >
        <cdf-app-avatar size="sm" [src]="avatarUrl()" [name]="displayName()" />
        <span class="bar__name">{{ displayName() }}</span>
      </button>

      @if (desktop()) {
        <!-- docs/05 §1: desktop header breadcrumb + global search. -->
        <nav
          class="bar__crumbs"
          data-testid="shell-breadcrumb"
          [attr.aria-label]="'studentPlatform.shell.breadcrumb' | translate"
        >
          <ol>
            @for (c of crumbs(); track $index; let last = $last) {
              <li>
                @if (c.url && !last) {
                  <a [routerLink]="c.url">{{
                    c.key ? (c.label | translate) : c.label
                  }}</a>
                } @else {
                  <span [attr.aria-current]="last ? 'page' : null">{{
                    c.key ? (c.label | translate) : c.label
                  }}</span>
                }
              </li>
            }
          </ol>
        </nav>
        <cdf-global-search class="bar__search" />
      }

      <div
        class="bar__stats"
        role="group"
        [attr.aria-label]="'studentPlatform.shell.statsLabel' | translate"
      >
        @if (level(); as lv) {
          <span
            class="stat"
            [attr.title]="
              'studentPlatform.shell.level' | translate: { level: lv }
            "
          >
            <cdf-icon name="star" size="xs" />{{ lv | locale: 'integer' }}
          </span>
        }
        <span
          class="stat stat--streak"
          cdfStreakTarget
          [attr.title]="
            'studentPlatform.shell.streak' | translate: { count: streak() }
          "
        >
          <cdf-icon name="flame" size="xs" />{{ streak() | locale: 'integer' }}
        </span>
        <span
          class="stat stat--coins"
          cdfCoinTarget
          data-testid="shell-coins"
          [attr.data-estimated]="estimate().coins > 0 || null"
          [attr.title]="
            estimate().coins > 0
              ? ('studentPlatform.shell.coinsEstimated'
                | translate: { count: coins() + estimate().coins })
              : ('studentPlatform.shell.coins' | translate: { count: coins() })
          "
        >
          <cdf-icon name="diamond" size="xs" />
          @if (estimate().coins > 0) {
            <span aria-hidden="true">≈</span>
          }
          {{ coins() + estimate().coins | locale: 'compact' }}
        </span>
        <span
          class="stat stat--xp"
          cdfXpTarget
          [attr.title]="'studentPlatform.shell.xp' | translate: { count: xp() }"
        >
          <cdf-icon name="sparkles" size="xs" />{{ xp() | locale: 'compact' }}
        </span>
      </div>

      <cdf-offline-indicator />

      <!-- Desktop: bell top-right (mobile: in the Today header). -->
      <cdf-notification-bell only="desktop" />

      @if (!desktop()) {
        <button
          type="button"
          class="bar__more"
          data-testid="shell-more"
          [attr.aria-label]="'studentPlatform.shell.more' | translate"
          [attr.aria-expanded]="moreOpen()"
          (click)="moreOpen.set(true)"
        >
          <cdf-icon name="menu-v" size="md" />
        </button>
      }
    </header>

    <cdf-app-shell
      class="shell"
      [brand]="'studentPlatform.shell.brand' | translate"
      [tabs]="tabs()"
    />

    <cdf-bottom-sheet
      [(open)]="moreOpen"
      [title]="'studentPlatform.shell.more' | translate"
    >
      <nav [attr.aria-label]="'studentPlatform.shell.moreNav' | translate">
        <ul class="more">
          @for (n of secondary(); track n.path) {
            <li>
              <a
                class="more__link"
                [routerLink]="['/', n.path]"
                (click)="moreOpen.set(false)"
              >
                <cdf-icon [name]="n.icon" size="md" />
                <span>{{ n.labelKey | translate }}</span>
              </a>
            </li>
          }
          <li>
            <a
              class="more__link"
              routerLink="/subscription"
              (click)="moreOpen.set(false)"
            >
              <cdf-icon name="diamond" size="md" />
              <span>{{ 'studentPlatform.nav.subscription' | translate }}</span>
            </a>
          </li>
        </ul>
      </nav>
      <div sheetFooter class="more__foot">
        <button type="button" class="more__signout" (click)="signOut()">
          <cdf-icon name="log-out" size="sm" />
          {{ 'common.signOut' | translate }}
        </button>
      </div>
    </cdf-bottom-sheet>

    <cdf-reward-overlays />
    <!-- docs/10 §3: promo alerts / browser notifications, after a lesson. -->
    <cdf-engagement-prompts />
    <cdf-storage-prompt />
    <cdf-sign-out-confirm />
    <!-- docs/14 "Minors": one-time date-of-birth prompt before the app. -->
    <cdf-birth-date-gate />
  `,
  styles: [
    `
      :host {
        --cdf-shell-header-h: calc(52px + env(safe-area-inset-top, 0px));
        display: block;
        position: absolute;
        inset: 0;
      }
      .bar {
        position: absolute;
        z-index: 25;
        top: 0;
        left: 0;
        right: 0;
        height: var(--cdf-shell-header-h);
        padding: env(safe-area-inset-top, 0px) 12px 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--cdf-color-surface-elev, #fff);
        border-bottom: 1px solid var(--cdf-color-border, #e5e7eb);
      }
      @media (min-width: 768px) {
        .bar {
          left: 240px;
          padding-inline: 20px;
        }
      }
      .bar__me {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 0 1 auto;
        background: none;
        border: 0;
        padding: 4px;
        border-radius: 999px;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .bar__name {
        font-weight: 600;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 22vw;
      }
      @media (min-width: 768px) {
        .bar__name {
          max-width: 240px;
        }
      }
      .bar__crumbs {
        display: none;
        min-width: 0;
        flex: 0 1 auto;
        font-size: 13px;
      }
      .bar__crumbs ol {
        display: flex;
        gap: 6px;
        list-style: none;
        margin: 0;
        padding: 0;
        white-space: nowrap;
        overflow: hidden;
      }
      .bar__crumbs li {
        display: inline-flex;
        gap: 6px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bar__crumbs li + li::before {
        content: '›';
        color: var(--cdf-color-text-muted, #6b7280);
      }
      .bar__crumbs a {
        color: var(--cdf-color-text-muted, #6b7280);
        text-decoration: none;
      }
      .bar__crumbs a:hover,
      .bar__crumbs a:focus-visible {
        text-decoration: underline;
      }
      .bar__crumbs span[aria-current] {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bar__search {
        flex: 0 1 280px;
        margin-inline-start: 8px;
      }
      @media (min-width: 1024px) {
        .bar__crumbs {
          display: block;
        }
        .bar__name {
          display: none;
        }
      }
      .bar__stats {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-inline-start: auto;
        font-size: 13px;
        font-weight: 600;
      }
      .stat {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        white-space: nowrap;
      }
      .stat--streak {
        color: var(--cdf-color-streak, #ea580c);
      }
      .stat--coins {
        color: var(--cdf-color-coin, #b45309);
      }
      .stat--xp {
        color: var(--cdf-color-xp, #7c3aed);
      }
      @media (max-width: 380px) {
        .stat--xp {
          display: none;
        }
      }
      .bar__more {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: none;
        border: 0;
        border-radius: 999px;
        color: inherit;
        cursor: pointer;
      }
      .bar__me:focus-visible,
      .bar__more:focus-visible,
      .more__link:focus-visible,
      .more__signout:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      /* Push the tabs/outlet below the header (AppShell owns the rest). */
      .shell ::ng-deep .cdf-shell__tabs {
        top: var(--cdf-shell-header-h);
        height: calc(100% - var(--cdf-shell-header-h));
      }
      .more {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .more__link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 10px;
        color: inherit;
        text-decoration: none;
        font-weight: 500;
      }
      .more__link:hover {
        background: var(--cdf-color-primary-subtle, #eef2ff);
      }
      .more__foot {
        display: flex;
        justify-content: flex-end;
      }
      .more__signout {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 0;
        color: var(--cdf-color-danger, #dc2626);
        font: inherit;
        font-weight: 600;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
    `,
  ],
})
export class ShellPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly identity = inject(IdentityCacheService);
  private readonly session = inject(AppSessionService);
  private readonly telemetry = inject(TelemetryService);
  private readonly xpState = inject(XpService);
  private readonly coinState = inject(CoinService);
  private readonly streakState = inject(StreakService);
  private readonly flags = inject(FeatureFlagsService);
  // Instantiate so the queue + download triggers are armed under the shell.
  protected readonly sync = inject(OfflineSyncService);
  protected readonly downloads = inject(DownloadService);

  protected readonly moreOpen = signal(false);
  protected readonly desktop = signal(matches(DESKTOP_QUERY));

  protected readonly displayName = computed(
    () =>
      this.identity.identity()?.displayName ??
      this.auth.user()?.displayName ??
      '',
  );
  protected readonly avatarUrl = computed(
    () =>
      this.identity.identity()?.avatarUrl ??
      this.auth.user()?.avatarUrl ??
      null,
  );
  protected readonly level = computed(() => this.xpState.level());
  protected readonly xp = computed(() => this.xpState.displayed());
  protected readonly coins = computed(() => this.coinState.displayed());
  protected readonly streak = computed(() => this.streakState.currentDays());
  /** Estimated rewards of queued offline completions (docs/16 §8). */
  protected readonly estimate = this.sync.pendingEstimate;

  private readonly breadcrumbs = inject(ShellBreadcrumbs);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      takeUntilDestroyed(),
    ),
    { initialValue: this.router.url },
  );
  /** Page-provided trail, else the nav label of the top-level route. */
  protected readonly crumbs = computed<Crumb[]>(() => {
    const own = this.breadcrumbs.trail();
    if (own) return own.crumbs;
    const top = (this.url() ?? '').split(/[/?#]/).filter(Boolean)[0] ?? 'today';
    const nav = NAV.find((n) => n.path === top);
    const label =
      nav?.labelKey ??
      (top === 'subscription'
        ? 'studentPlatform.nav.subscription'
        : top === 'courses' || top === 'lessons'
          ? 'studentPlatform.nav.catalog'
          : 'studentPlatform.shell.brand');
    return [{ label, key: true }];
  });

  /** Phone: 5 primary tabs (rest under "More"); desktop sidebar: all. */
  protected readonly tabs = computed<ShellTab[]>(() => {
    this.i18n.currentLocale(); // re-label on locale change
    const nav = this.visibleNav();
    const entries = this.desktop() ? nav : nav.filter((n) => n.primary);
    return entries.map((n) => ({
      path: n.path,
      label: this.i18n.t(n.labelKey),
      icon: n.icon,
    }));
  });
  protected readonly secondary = computed(() =>
    this.visibleNav().filter((n) => !n.primary),
  );
  /** NAV minus surfaces whose feature flag is off. */
  private readonly visibleNav = computed(() =>
    NAV.filter((n) => !n.feature || this.flags.isOn(n.feature)),
  );

  constructor() {
    void this.downloads.hydrate();
    // docs/11 §6: send the device time zone on first sign-in / when it moves.
    void inject(TimeZoneSync).check();
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia(DESKTOP_QUERY);
      const onChange = () => this.desktop.set(mq.matches);
      mq.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() =>
        mq.removeEventListener?.('change', onChange),
      );
    }
  }

  /** Clerk: account modal (email, security, sessions); dev: profile page. */
  protected openAccount(): void {
    this.telemetry.track('account_opened', { mode: this.auth.mode });
    if (this.auth.mode === 'clerk') this.auth.openUserProfile();
    else void this.router.navigateByUrl('/profile');
  }

  protected signOut(): void {
    this.moreOpen.set(false);
    void this.session.requestSignOut();
  }
}

function matches(query: string): boolean {
  try {
    return (
      typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
    );
  } catch {
    return false;
  }
}
