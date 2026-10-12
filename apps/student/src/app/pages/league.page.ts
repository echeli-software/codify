import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  type RefresherCustomEvent,
} from '@ionic/angular/standalone';
import {
  AppAvatar,
  AvatarRenderer,
  AppButton,
  AppCard,
  AppSkeleton,
  BottomSheet,
  CoinBadge,
  EmptyState,
  ErrorState,
  Icon,
  LeaderboardAvatar,
  LeaderboardTable,
  XpBadge,
  type LeaderboardRow,
} from '@codify/ui-ionic';
import {
  LeaguesClient,
  type AvatarResponse,
  ProblemDetailsError,
  type CurrentLeague,
  type LastWeekResult,
} from '@codify/api-client';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { errorMessageKey } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { formatCountdown } from './shared/countdown.js';
import { equippedSprites } from './shared/avatar.js';

const SEEN_KEY = 'codify.league.lastWeekSeen';

const TIER_ICON: Record<string, string> = {
  BRONZE: '🥉',
  SILVER: '🥈',
  GOLD: '🥇',
  PLATINUM: '💠',
  DIAMOND: '💎',
};

/** Has the last-week summary for `weekStart` already been shown? */
export function lastWeekSeen(
  weekStart: string,
  storage: Pick<Storage, 'getItem'> | null,
): boolean {
  try {
    return storage?.getItem(SEEN_KEY) === weekStart;
  } catch {
    return false;
  }
}

/**
 * Weekly league (docs/07 §9): tier + rank, a live countdown to the reset,
 * the virtualized standings with promotion / demotion zones taken from the
 * API's counts, and — once per week — a summary sheet of last week's
 * result (promoted / held / demoted, rewards).
 */
/** An avatar worth rendering: a saved config or at least one equipped item. */
export function hasAvatar(a: AvatarResponse | null | undefined): boolean {
  return !!a && (!!a.config || Object.values(a.equipped).some(Boolean));
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    AppAvatar,
    AvatarRenderer,
    AppButton,
    AppCard,
    AppSkeleton,
    BottomSheet,
    CoinBadge,
    EmptyState,
    ErrorState,
    Icon,
    LeaderboardAvatar,
    LeaderboardTable,
    XpBadge,
    OfflineGate,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.league.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>
      <div class="lg">
        <cdf-offline-gate capability="leaderboard">
          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="96" />
            <cdf-app-skeleton shape="rect" [height]="320" />
          } @else if (errorKey(); as e) {
            <cdf-error-state
              [title]="'student.league.loadError' | translate"
              [description]="e | translate"
              (retry)="load()"
            />
          } @else if (league(); as lg) {
            <cdf-app-card
              padding="normal"
              class="lg__card"
              data-testid="league-hero"
            >
              <div class="lg__hero">
                <span class="lg__tier" aria-hidden="true">{{
                  tierIcon(lg.tier)
                }}</span>
                <div class="lg__hero-copy">
                  <h1>
                    {{
                      'student.league.tierLeague'
                        | translate
                          : { tier: ('ui.tier.' + lg.tier | translate) }
                    }}
                  </h1>
                  <p class="lg__muted" data-testid="league-reset">
                    <cdf-icon name="hourglass" size="xs" />
                    {{
                      'student.league.resetsIn'
                        | translate: { time: countdown() }
                    }}
                  </p>
                </div>
                <div class="lg__rank">
                  <span class="lg__rank-num" data-testid="my-rank">{{
                    'student.league.rank' | translate: { rank: lg.myRank }
                  }}</span>
                  <cdf-xp-badge [value]="lg.myWeeklyXp" size="sm" />
                </div>
              </div>
            </cdf-app-card>

            <p class="lg__legend">
              <span class="lg__zone lg__zone--up">
                <cdf-icon name="chevron-up" size="xs" />
                {{
                  'student.league.promoteLegend'
                    | translate: { count: lg.promoteCount }
                }}
              </span>
              @if (lg.demoteCount > 0) {
                <span class="lg__zone lg__zone--down">
                  <cdf-icon name="chevron-down" size="xs" />
                  {{
                    'student.league.demoteLegend'
                      | translate: { count: lg.demoteCount }
                  }}
                </span>
              }
              @if (lastWeek()) {
                <button
                  type="button"
                  class="lg__link"
                  (click)="sheetOpen.set(true)"
                  data-testid="last-week-btn"
                >
                  {{ 'student.league.lastWeekButton' | translate }}
                </button>
              }
            </p>

            <cdf-leaderboard-table
              data-testid="leaderboard"
              [rows]="rows()"
              [promoteCount]="lg.promoteCount"
              [demoteCount]="lg.demoteCount"
              [visibleRows]="10"
              [title]="'student.league.standings' | translate"
            >
              <ng-template cdfLeaderboardAvatar let-row>
                <a
                  class="lg__avatar"
                  [routerLink]="['/u', row.userId]"
                  [attr.aria-label]="
                    'student.league.viewProfile'
                      | translate: { name: row.displayName }
                  "
                  [attr.data-user-id]="row.userId"
                >
                  @if (sprites().get(row.userId); as av) {
                    <cdf-avatar-renderer
                      [config]="av.config"
                      [equipped]="av.equipped"
                      [size]="32"
                    />
                  } @else {
                    <cdf-app-avatar [name]="row.displayName" size="sm" />
                  }
                </a>
              </ng-template>
            </cdf-leaderboard-table>
          } @else {
            <cdf-empty-state
              icon="podium"
              [title]="'student.league.emptyTitle' | translate"
              [description]="'student.league.emptyBody' | translate"
            >
              <cdf-app-button kind="primary" routerLink="/catalog">{{
                'student.league.emptyCta' | translate
              }}</cdf-app-button>
            </cdf-empty-state>
          }
        </cdf-offline-gate>
      </div>

      @if (lastWeek(); as lw) {
        <cdf-bottom-sheet
          [open]="sheetOpen()"
          (openChange)="onSheet($event)"
          [title]="'student.league.lastWeek.title' | translate"
        >
          <div class="lw" data-testid="last-week-sheet">
            <p class="lw__headline" [attr.data-outcome]="outcome(lw)">
              {{
                'student.league.lastWeek.' + outcome(lw)
                  | translate: { tier: ('ui.tier.' + lw.newTier | translate) }
              }}
            </p>
            <p>
              {{
                'student.league.lastWeek.finished'
                  | translate
                    : {
                        rank: lw.finalRank,
                        size: lw.cohortSize,
                        tier: ('ui.tier.' + lw.tier | translate),
                      }
              }}
            </p>
            <p class="lg__muted">
              {{
                'student.league.lastWeek.week'
                  | translate: { date: (lw.weekStart | locale: 'date') }
              }}
            </p>
            @if (lw.xpReward || lw.coinReward || lw.freezeAwarded) {
              <div class="lw__rewards">
                @if (lw.xpReward) {
                  <cdf-xp-badge [value]="lw.xpReward" />
                }
                @if (lw.coinReward) {
                  <cdf-coin-badge [value]="lw.coinReward" />
                }
                @if (lw.freezeAwarded) {
                  <span>{{
                    'student.league.lastWeek.freeze' | translate
                  }}</span>
                }
              </div>
            }
          </div>
          <div sheetFooter>
            <cdf-app-button
              kind="primary"
              [fullWidth]="true"
              (buttonClick)="onSheet(false)"
            >
              {{ 'student.league.lastWeek.cta' | translate }}
            </cdf-app-button>
          </div>
        </cdf-bottom-sheet>
      }
    </ion-content>
  `,
  styles: [
    `
      .lg {
        max-width: 1280px;
        margin: 0 auto;
      }
      .lg__card {
        display: block;
        margin-bottom: var(--cdf-space-2);
      }
      .lg__hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
      }
      .lg__tier {
        font-size: 40px;
      }
      .lg__hero-copy h1 {
        margin: 0;
        font-size: var(--cdf-font-size-lg);
      }
      .lg__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 2px 0 0;
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .lg__rank {
        margin-left: auto;
        text-align: right;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }
      .lg__rank-num {
        font-size: 24px;
        font-weight: 800;
      }
      .lg__legend {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        flex-wrap: wrap;
        font-size: var(--cdf-font-size-sm);
        margin: var(--cdf-space-3) 0 var(--cdf-space-2);
      }
      .lg__zone {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .lg__zone--up {
        color: var(--cdf-color-success);
      }
      .lg__zone--down {
        color: var(--cdf-color-danger);
      }
      .lg__link {
        margin-left: auto;
        background: none;
        border: 0;
        padding: 4px 0;
        color: var(--cdf-color-primary);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        text-decoration: underline;
      }
      .lg__avatar {
        display: inline-flex;
        border-radius: 50%;
      }
      .lg__avatar:focus-visible,
      .lg__link:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .lw__headline {
        font-size: var(--cdf-font-size-lg);
        font-weight: 700;
        margin-top: 0;
      }
      .lw__rewards {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class LeaguePage {
  private readonly client = inject(LeaguesClient);
  /** userId → renderer inputs, for members who customised their avatar. */
  protected readonly sprites = computed(() => {
    const out = new Map<
      string,
      {
        config: Record<string, unknown> | null;
        equipped: ReturnType<typeof equippedSprites>;
      }
    >();
    for (const m of this.league()?.members ?? []) {
      if (!hasAvatar(m.avatar)) continue;
      out.set(m.userId, {
        config: m.avatar.config,
        equipped: equippedSprites(m.avatar),
      });
    }
    return out;
  });
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly league = signal<CurrentLeague | null>(null);
  protected readonly lastWeek = signal<LastWeekResult | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly now = signal(Date.now());

  protected readonly rows = computed<LeaderboardRow[]>(() =>
    (this.league()?.members ?? []).map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      weeklyXp: m.weeklyXp,
      level: m.level,
      rank: m.rank,
      isMe: m.isMe,
    })),
  );

  protected readonly countdown = computed(() => {
    const lg = this.league();
    this.i18n.currentLocale();
    if (!lg) return '';
    return formatCountdown(
      new Date(lg.resetAt).getTime() - this.now(),
      (k, p) => this.i18n.t(k, p),
    );
  });

  constructor() {
    void this.load();
    const t = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const lg = await this.client.currentLeague();
      this.league.set(lg);
      this.telemetry.track('league_viewed', {
        tier: lg.tier,
        rank: lg.myRank,
        cohortSize: lg.cohortSize,
      });
    } catch (err) {
      // 404 = not placed in a cohort yet (no XP this week) → empty state.
      if (!(err instanceof ProblemDetailsError && err.isNotFound)) {
        this.errorKey.set(errorMessageKey(err));
      }
      this.league.set(null);
    } finally {
      this.loading.set(false);
    }
    void this.loadLastWeek();
  }

  private async loadLastWeek(): Promise<void> {
    try {
      const lw = await this.client.lastWeek();
      this.lastWeek.set(lw);
      if (!lastWeekSeen(lw.weekStart, safeStorage())) this.sheetOpen.set(true);
    } catch {
      // 404 = no finished week yet; nothing to show.
      this.lastWeek.set(null);
    }
  }

  protected async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await this.load();
    await ev.target.complete();
  }

  protected onSheet(open: boolean): void {
    this.sheetOpen.set(open);
    const lw = this.lastWeek();
    if (!open && lw) {
      try {
        localStorage.setItem(SEEN_KEY, lw.weekStart);
      } catch {
        // Storage unavailable — the sheet may show again; harmless.
      }
      this.telemetry.track('league_result_viewed', {
        tier: lw.tier,
        newTier: lw.newTier,
        promoted: lw.promoted,
        demoted: lw.demoted,
        finalRank: lw.finalRank,
      });
    }
  }

  protected outcome(lw: LastWeekResult): 'promoted' | 'demoted' | 'held' {
    return lw.promoted ? 'promoted' : lw.demoted ? 'demoted' : 'held';
  }

  protected tierIcon(tier: string): string {
    return TIER_ICON[tier] ?? '🏅';
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
