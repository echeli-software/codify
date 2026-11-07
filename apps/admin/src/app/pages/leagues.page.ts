import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  type BadgeVariant,
  Button,
  Drawer,
  EmptyState,
  Icon,
  Skeleton,
} from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  type AdminLeagueTier,
  type LeagueDetail,
  type LeagueSnapshot,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';

const ZONE_VARIANT: Record<
  LeagueDetail['members'][number]['zone'],
  BadgeVariant
> = {
  promote: 'success',
  demote: 'danger',
  stay: 'neutral',
};

/** `YYYY-MM-DD` of the UTC Monday `weeks` weeks after `weekStartIso`. */
export function shiftWeek(weekStartIso: string, weeks: number): string {
  const d = new Date(weekStartIso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of the UTC Monday of the week containing `now`. */
export function utcWeekStart(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Week to request after moving: undefined means "the current week". */
export function weekAfterMove(
  shownWeekStartIso: string,
  weeks: number,
  now = new Date(),
): string | undefined {
  const next = shiftWeek(shownWeekStartIso, weeks);
  return next >= utcWeekStart(now) ? undefined : next;
}

/**
 * Gamification → Leagues (docs/04): the week's snapshot per tier (league
 * count, members, p50/p95 weekly XP), every cohort, and a drill-in with
 * members, ranks and projected promotion/relegation zones. Zone sizes are
 * code constants; rewards are the `league.*` keys edited under
 * Gamification → Defaults.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Badge,
    Button,
    Drawer,
    EmptyState,
    Icon,
    LoadError,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.leagues.title' | translate }}</h1>
          <p class="muted">{{ 'admin.leagues.subtitle' | translate }}</p>
        </div>
        <div class="page-head__actions week-nav">
          <cdf-button kind="ghost" size="sm" (click)="go(-1)">
            <cdf-icon name="caret-left" size="sm" />
            {{ 'admin.leagues.prevWeek' | translate }}
          </cdf-button>
          <span class="small" aria-live="polite">
            @if (snapshot(); as s) {
              {{
                'admin.leagues.weekOf'
                  | translate: { date: (s.weekStart | locale: 'date') }
              }}
            }
          </span>
          <cdf-button
            kind="ghost"
            size="sm"
            [disabled]="isCurrentWeek()"
            (click)="go(1)"
          >
            {{ 'admin.leagues.nextWeek' | translate }}
            <cdf-icon name="caret-right" size="sm" />
          </cdf-button>
        </div>
      </header>

      @if (error(); as e) {
        <cdf-load-error [message]="e" (retry)="load()" />
      } @else if (!snapshot()) {
        <cdf-skeleton shape="rect" height="220px" />
      } @else {
        <section class="admin-card" aria-labelledby="tiers-title">
          <h2 id="tiers-title">{{ 'admin.leagues.snapshot' | translate }}</h2>
          <div class="table-scroll">
            <table class="admin-table" data-testid="tier-table">
              <thead>
                <tr>
                  <th scope="col">{{ 'admin.leagues.tier' | translate }}</th>
                  <th scope="col" class="num">
                    {{ 'admin.leagues.leagues' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.leagues.members' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.leagues.p50' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.leagues.p95' | translate }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (t of snapshot()!.tiers; track t.tier) {
                  <tr>
                    <th scope="row">{{ tierLabel(t.tier) }}</th>
                    <td class="num">{{ t.leagues | locale: 'integer' }}</td>
                    <td class="num">{{ t.members | locale: 'integer' }}</td>
                    <td class="num">{{ t.p50WeeklyXp | locale: 'integer' }}</td>
                    <td class="num">{{ t.p95WeeklyXp | locale: 'integer' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <div class="split">
          <section class="admin-card" aria-labelledby="cohorts-title">
            <h2 id="cohorts-title">
              {{ 'admin.leagues.cohorts' | translate }}
            </h2>
            @if (snapshot()!.leagues.length === 0) {
              <cdf-empty-state
                icon="trophy"
                [title]="'admin.leagues.emptyTitle' | translate"
                [description]="'admin.leagues.emptyDescription' | translate"
              />
            } @else {
              <div class="table-scroll">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ 'admin.leagues.tier' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.leagues.cohort' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.leagues.members' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.leagues.topXp' | translate }}
                      </th>
                      <th scope="col">
                        <span class="visually-hidden">{{
                          'admin.common.actions' | translate
                        }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of snapshot()!.leagues; track l.id) {
                      <tr>
                        <td>{{ tierLabel(l.tier) }}</td>
                        <td class="mono">{{ l.cohortKey }}</td>
                        <td class="num">{{ l.members | locale: 'integer' }}</td>
                        <td class="num">
                          {{ l.topWeeklyXp | locale: 'integer' }}
                        </td>
                        <td>
                          <cdf-button
                            kind="ghost"
                            size="sm"
                            (click)="open(l.id)"
                            [attr.data-league]="l.id"
                            >{{ 'admin.leagues.view' | translate }}</cdf-button
                          >
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <section class="admin-card" aria-labelledby="rules-title">
            <h2 id="rules-title">{{ 'admin.leagues.rules' | translate }}</h2>
            @let r = snapshot()!.rules;
            <dl class="kv">
              <dt>{{ 'admin.leagues.cohortCapacity' | translate }}</dt>
              <dd>{{ r.cohortCapacity }}</dd>
              <dt>{{ 'admin.leagues.promotion' | translate }}</dt>
              <dd>
                {{
                  'admin.leagues.promotionRule'
                    | translate
                      : { count: r.promoteCount, capacity: r.cohortCapacity }
                }}
              </dd>
              <dt>{{ 'admin.leagues.relegation' | translate }}</dt>
              <dd>
                {{
                  'admin.leagues.relegationRule'
                    | translate
                      : {
                          count: r.demoteCount,
                          capacity: r.cohortCapacity,
                          min: r.minCohortForDemotion,
                        }
                }}
              </dd>
              <dt>{{ 'admin.leagues.promotionReward' | translate }}</dt>
              <dd>
                {{
                  'admin.leagues.rewardFreeze'
                    | translate
                      : {
                          xp: r.promotionReward.xp,
                          coins: r.promotionReward.coins,
                          freeze: r.promotionReward.freeze,
                        }
                }}
              </dd>
              <dt>{{ 'admin.leagues.rank1Reward' | translate }}</dt>
              <dd>
                {{
                  'admin.gamification.rewardShort'
                    | translate
                      : { xp: r.rank1Reward.xp, coins: r.rank1Reward.coins }
                }}
              </dd>
            </dl>
            <p class="muted small">
              {{ 'admin.leagues.rulesHelp' | translate }}
              <a routerLink="/gamification">{{
                'admin.leagues.editRewards' | translate
              }}</a>
            </p>
          </section>
        </div>
      }
    </div>

    <cdf-drawer
      [(open)]="drawerOpen"
      size="lg"
      [title]="
        detail()
          ? ('admin.leagues.detailTitle'
            | translate
              : {
                  tier: tierLabel(detail()!.tier),
                  cohort: detail()!.cohortKey,
                })
          : ('admin.leagues.detailLoading' | translate)
      "
    >
      @if (detailError(); as e) {
        <cdf-load-error [message]="e" (retry)="open(openId)" />
      } @else if (!detail()) {
        <cdf-skeleton shape="rect" height="200px" />
      } @else {
        <p class="muted small">
          {{
            'admin.leagues.zones'
              | translate
                : {
                    promote: detail()!.promoteZone,
                    demote: detail()!.demoteZone,
                  }
          }}
        </p>
        <div class="table-scroll">
          <table class="admin-table" data-testid="league-members">
            <thead>
              <tr>
                <th scope="col" class="num">
                  {{ 'admin.leagues.rank' | translate }}
                </th>
                <th scope="col">{{ 'admin.leagues.member' | translate }}</th>
                <th scope="col" class="num">
                  {{ 'admin.leagues.weeklyXp' | translate }}
                </th>
                <th scope="col">{{ 'admin.leagues.zone' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (m of detail()!.members; track m.userId) {
                <tr>
                  <td class="num">{{ m.finalRank ?? m.rank }}</td>
                  <td>
                    <a [routerLink]="['/users', m.userId]">{{
                      m.displayName
                    }}</a>
                  </td>
                  <td class="num">{{ m.weeklyXp | locale: 'integer' }}</td>
                  <td>
                    <cdf-badge
                      [variant]="zoneVariant(m.zone)"
                      [subtle]="true"
                      >{{
                        'admin.leagues.zoneNames.' + outcome(m) | translate
                      }}</cdf-badge
                    >
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </cdf-drawer>
  `,
  styles: [
    `
      .week-nav {
        gap: var(--cdf-space-1, 4px);
      }
      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 16px;
        margin: 0 0 var(--cdf-space-2);
      }
      .kv dt {
        color: var(--cdf-color-text-muted);
      }
      .kv dd {
        margin: 0;
      }
    `,
  ],
})
export class LeaguesPage {
  private readonly client = inject(AdminOpsClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly snapshot = signal<LeagueSnapshot | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<LeagueDetail | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected drawerOpen = false;
  protected openId = '';
  /** Requested week (YYYY-MM-DD inside it); undefined = current week. */
  private readonly week = signal<string | undefined>(undefined);
  protected readonly isCurrentWeek = computed(() => this.week() === undefined);

  constructor() {
    void this.load();
  }

  protected tierLabel(tier: AdminLeagueTier): string {
    return this.i18n.t(`admin.leagues.tiers.${tier}`);
  }

  protected zoneVariant(z: LeagueDetail['members'][number]['zone']) {
    return ZONE_VARIANT[z];
  }

  /** Past weeks show the stored outcome; the live week the projection. */
  protected outcome(m: LeagueDetail['members'][number]): string {
    if (m.promoted) return 'promoted';
    if (m.demoted) return 'demoted';
    if (m.finalRank !== null) return 'stayed';
    return m.zone;
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.snapshot.set(null);
    try {
      this.snapshot.set(await this.client.leagueSnapshot(this.week()));
    } catch (err) {
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected go(weeks: number): void {
    const base = this.snapshot()?.weekStart;
    if (!base) return;
    this.week.set(weekAfterMove(base, weeks));
    void this.load();
  }

  protected async open(id: string): Promise<void> {
    this.openId = id;
    this.drawerOpen = true;
    this.detail.set(null);
    this.detailError.set(null);
    try {
      this.detail.set(await this.client.league(id));
    } catch (err) {
      this.detailError.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }
}
