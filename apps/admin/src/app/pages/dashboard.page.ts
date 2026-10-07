import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { Icon, ProgressBar, Skeleton } from '@codify/ui-bootstrap';
import {
  AnalyticsClient,
  TranslationsClient,
  type TranslationCompleteness,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { canAccess, navForRole } from '../core/roles';

/**
 * Landing page: role-aware shortcuts into every section the user can open,
 * translation completeness per locale and (ADMIN) last-7-days event totals.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, ProgressBar, Skeleton, TranslatePipe, LocalePipe],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.dashboard.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.dashboard.subtitle' | translate: { name: name() } }}
          </p>
        </div>
      </header>

      @if (showAnalytics()) {
        <section class="stat-grid" aria-live="polite">
          <div class="stat">
            <div class="stat__label">
              {{ 'admin.dashboard.events7d' | translate }}
            </div>
            <div class="stat__value">
              @if (eventTotal() === null) {
                <cdf-skeleton shape="text" />
              } @else {
                {{ eventTotal() | locale: 'number' }}
              }
            </div>
          </div>
          @for (e of topEvents(); track e.name) {
            <div class="stat">
              <div class="stat__label mono">{{ e.name }}</div>
              <div class="stat__value">{{ e.count | locale: 'number' }}</div>
            </div>
          }
        </section>
      }

      @if (completeness(); as c) {
        <section class="admin-card">
          <h2>{{ 'admin.dashboard.translations' | translate }}</h2>
          <ul class="plain-list completeness">
            @for (loc of locales(c); track loc.locale) {
              <li>
                <span>{{ loc.locale }}</span>
                <cdf-progress-bar
                  [value]="loc.pct"
                  [label]="
                    'admin.dashboard.completeness'
                      | translate: { locale: loc.locale }
                  "
                />
                <span class="mono">{{
                  loc.pct / 100 | locale: 'percent'
                }}</span>
              </li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="dash-sections">
        <h2 id="dash-sections" class="visually-hidden">
          {{ 'admin.dashboard.sections' | translate }}
        </h2>
        <ul class="plain-list tiles">
          @for (item of shortcuts(); track item.link) {
            <li>
              <a class="tile" [routerLink]="item.link">
                <cdf-icon [name]="item.icon" size="lg" />
                <span class="tile__label">{{ item.labelKey | translate }}</span>
                <span class="tile__hint muted small">{{
                  'admin.dashboard.hint.' + item.section | translate
                }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    </div>
  `,
  styles: [
    `
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--cdf-space-3);
      }
      .tile {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        padding: var(--cdf-space-4);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
      }
      .tile:hover {
        border-color: var(--cdf-color-primary);
      }
      .tile__label {
        font-weight: 600;
      }
      .completeness li {
        display: grid;
        grid-template-columns: 64px 1fr 56px;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: 8px;
      }
    `,
  ],
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsClient);
  private readonly translations = inject(TranslationsClient);
  private readonly errors = inject(AdminErrors);

  protected readonly name = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly showAnalytics = computed(() =>
    canAccess('analytics', this.auth.role()),
  );
  protected readonly shortcuts = computed(() =>
    navForRole(this.auth.role())
      .flatMap((g) => g.items)
      .filter((i) => i.section !== 'dashboard'),
  );
  protected readonly eventTotal = signal<number | null>(null);
  protected readonly topEvents = signal<{ name: string; count: number }[]>([]);
  protected readonly completeness = signal<TranslationCompleteness | null>(
    null,
  );

  constructor() {
    if (this.showAnalytics()) void this.loadAnalytics();
    void this.loadCompleteness();
  }

  protected locales(c: TranslationCompleteness) {
    return Object.entries(c.locales).map(([locale, byType]) => ({
      locale,
      pct: Math.round(byType.ALL?.pct ?? 0),
    }));
  }

  private async loadAnalytics(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    try {
      const rows = await this.analytics.summary(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      );
      const byName = new Map<string, number>();
      for (const r of rows)
        byName.set(r.name, (byName.get(r.name) ?? 0) + r.count);
      this.eventTotal.set([...byName.values()].reduce((a, b) => a + b, 0));
      this.topEvents.set(
        [...byName.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3),
      );
    } catch (err) {
      this.eventTotal.set(0);
      this.errors.toast(err, 'admin.errors.loadFailed');
    }
  }

  private async loadCompleteness(): Promise<void> {
    try {
      this.completeness.set(await this.translations.completeness());
    } catch {
      // Optional panel — the translations page surfaces errors in full.
      this.completeness.set(null);
    }
  }
}
