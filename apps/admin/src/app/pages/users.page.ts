import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Avatar,
  Badge,
  EmptyState,
  FormField,
  Pagination,
  SearchBar,
  Select,
  type SelectOption,
  Skeleton,
} from '@codify/ui-bootstrap';
import {
  UsersClient,
  type AdminUserListItem,
  type ApiUserRole,
  type UserCountryCount,
  type UserListQuery,
  type UserSubscriptionFilter,
} from '@codify/api-client';
import { LoadError } from '../core/load-error';
import { COUNTRY_UNKNOWN, countryName } from '../core/country';

const PAGE_SIZE = 25;

/** "Last seen" filter presets. */
export const LAST_SEEN_PRESETS = ['any', '1d', '7d', '30d', 'over30d'] as const;
export type LastSeenPreset = (typeof LAST_SEEN_PRESETS)[number];

export const SUBSCRIPTION_FILTERS: readonly UserSubscriptionFilter[] = [
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'UNPAID',
  'PAUSED',
  'NONE',
];

const DAY_MS = 86_400_000;

/** `lastSeenFrom` / `lastSeenTo` (ISO) for a "last seen" preset. */
export function lastSeenRange(
  preset: LastSeenPreset,
  now = new Date(),
): Pick<UserListQuery, 'lastSeenFrom' | 'lastSeenTo'> {
  const ago = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();
  switch (preset) {
    case '1d':
      return { lastSeenFrom: ago(1) };
    case '7d':
      return { lastSeenFrom: ago(7) };
    case '30d':
      return { lastSeenFrom: ago(30) };
    case 'over30d':
      return { lastSeenTo: ago(30) };
    default:
      return {};
  }
}

/**
 * Users (docs/04): paginated list with server-side search (email, name or
 * id) and role, locale, last-seen and subscription-status filters, linking
 * to the user detail. ADMIN + SUPPORT.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Avatar,
    Badge,
    EmptyState,
    FormField,
    Pagination,
    SearchBar,
    Select,
    Skeleton,
    LoadError,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.users.title' | translate }}</h1>
          <p class="muted">{{ 'admin.users.subtitle' | translate }}</p>
        </div>
      </header>

      <div class="toolbar">
        <cdf-search-bar
          class="search"
          [placeholder]="'admin.users.searchPlaceholder' | translate"
          [ariaLabel]="'admin.users.search' | translate"
          (query)="onSearch($event)"
        />
        <cdf-form-field
          [label]="'admin.users.role' | translate"
          controlId="users-role"
        >
          <cdf-select
            inputId="users-role"
            [options]="roleOptions()"
            [ngModel]="role()"
            (ngModelChange)="onRole($event ?? '')"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.users.locale' | translate"
          controlId="users-locale"
        >
          <cdf-select
            inputId="users-locale"
            [options]="localeOptions()"
            [ngModel]="locale()"
            (ngModelChange)="onFilter(locale, $event ?? '')"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.users.lastSeen' | translate"
          controlId="users-last-seen"
        >
          <cdf-select
            inputId="users-last-seen"
            [options]="lastSeenOptions()"
            [ngModel]="lastSeen()"
            (ngModelChange)="onFilter(lastSeen, $event ?? 'any')"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.users.subscription' | translate"
          controlId="users-sub"
        >
          <cdf-select
            inputId="users-sub"
            [options]="subscriptionOptions()"
            [ngModel]="subscription()"
            (ngModelChange)="onFilter(subscription, $event ?? '')"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.users.country' | translate"
          controlId="users-country"
        >
          <cdf-select
            inputId="users-country"
            [options]="countryOptions()"
            [ngModel]="country()"
            (ngModelChange)="onFilter(country, $event ?? '')"
          />
        </cdf-form-field>
      </div>
      <p class="muted small" aria-live="polite">
        @if (query() || filtered()) {
          {{ 'admin.users.searchResults' | translate: { count: total() } }}
        } @else {
          {{
            'admin.common.showing'
              | translate: { shown: visible().length, total: total() }
          }}
        }
      </p>

      @if (loadError(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="reload()" />
      } @else if (loading()) {
        <cdf-skeleton shape="rect" height="240px" />
      } @else if (visible().length === 0) {
        <cdf-empty-state
          icon="user-circle"
          [title]="'admin.users.emptyTitle' | translate"
          [description]="'admin.common.emptyFilter' | translate"
        />
      } @else {
        <div class="table-scroll admin-card">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">{{ 'admin.users.user' | translate }}</th>
                <th scope="col">{{ 'admin.users.role' | translate }}</th>
                <th scope="col">{{ 'admin.users.locale' | translate }}</th>
                <th scope="col">{{ 'admin.users.country' | translate }}</th>
                <th scope="col">{{ 'admin.users.lastSeen' | translate }}</th>
                <th scope="col">{{ 'admin.users.joined' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (u of visible(); track u.id) {
                <tr>
                  <td>
                    <a class="user-cell" [routerLink]="['/users', u.id]">
                      <cdf-avatar [name]="u.displayName" size="sm" />
                      <span>
                        <strong>{{ u.displayName }}</strong>
                        <span class="muted small d-block">{{ u.email }}</span>
                      </span>
                    </a>
                  </td>
                  <td>
                    <cdf-badge
                      [variant]="u.role === 'STUDENT' ? 'neutral' : 'info'"
                      [subtle]="true"
                      >{{ 'admin.roles.' + u.role | translate }}</cdf-badge
                    >
                  </td>
                  <td>{{ u.locale }}</td>
                  <td [attr.title]="u.country ?? null">
                    {{
                      countryLabel(u.country) ??
                        ('admin.users.countryUnknown' | translate)
                    }}
                  </td>
                  <td class="small">
                    {{
                      u.lastSeenAt
                        ? (u.lastSeenAt | locale: 'relative')
                        : ('admin.users.never' | translate)
                    }}
                  </td>
                  <td class="small">{{ u.createdAt | locale: 'date' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (totalPages() > 1) {
          <cdf-pagination
            [page]="page()"
            [totalPages]="totalPages()"
            (pageChange)="goTo($event)"
          />
        }
      }
    </div>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-2);
      }
      .search {
        flex: 1 1 280px;
      }
      .user-cell {
        display: inline-flex;
        align-items: center;
        gap: var(--cdf-space-2);
        color: inherit;
      }
      .d-block {
        display: block;
      }
    `,
  ],
})
export class UsersPage {
  private readonly users = inject(UsersClient);
  private readonly i18n = inject(I18nService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<unknown>(null);
  protected readonly pageRows = signal<AdminUserListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly query = signal('');
  protected readonly role = signal<ApiUserRole | ''>('');
  protected readonly locale = signal('');
  protected readonly lastSeen = signal<LastSeenPreset>('any');
  protected readonly subscription = signal<UserSubscriptionFilter | ''>('');
  /** ISO code, COUNTRY_UNKNOWN or '' (any). */
  protected readonly country = signal('');
  private readonly countries = signal<UserCountryCount[]>([]);
  private seq = 0;

  /** Countries present among users (by name), then "Unknown". */
  protected readonly countryOptions = computed<SelectOption<string>[]>(() => {
    const locale = this.i18n.currentLocale();
    const known = this.countries()
      .filter((c): c is { country: string; users: number } => !!c.country)
      .map((c) => ({
        value: c.country,
        label: `${countryName(c.country, locale)} (${c.country})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
    return [
      { value: '', label: this.i18n.t('admin.users.allCountries') },
      ...known,
      {
        value: COUNTRY_UNKNOWN,
        label: this.i18n.t('admin.users.countryUnknown'),
      },
    ];
  });

  protected readonly localeOptions = computed<SelectOption<string>[]>(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.users.allLocales') },
      ...this.i18n.availableLocales.map((l) => ({
        value: l.code as string,
        label: l.nativeName,
      })),
    ];
  });
  protected readonly lastSeenOptions = computed<SelectOption<LastSeenPreset>[]>(
    () => {
      this.i18n.currentLocale();
      return LAST_SEEN_PRESETS.map((p) => ({
        value: p,
        label: this.i18n.t(`admin.users.lastSeenPresets.${p}`),
      }));
    },
  );
  protected readonly subscriptionOptions = computed<
    SelectOption<UserSubscriptionFilter | ''>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.users.anySubscription') },
      ...SUBSCRIPTION_FILTERS.map((s) => ({
        value: s,
        label:
          s === 'NONE'
            ? this.i18n.t('admin.users.noSubscription')
            : this.i18n.t(`admin.users.subs.status.${s}`),
      })),
    ];
  });

  protected readonly roleOptions = computed<SelectOption<ApiUserRole | ''>[]>(
    () => {
      this.i18n.currentLocale();
      return [
        { value: '', label: this.i18n.t('admin.users.allRoles') },
        ...(['STUDENT', 'TEACHER', 'SUPPORT', 'ADMIN'] as const).map((r) => ({
          value: r,
          label: this.i18n.t(`admin.roles.${r}`),
        })),
      ];
    },
  );

  protected readonly visible = this.pageRows.asReadonly();
  protected readonly filtered = computed(
    () =>
      !!this.role() ||
      !!this.locale() ||
      this.lastSeen() !== 'any' ||
      !!this.subscription() ||
      !!this.country(),
  );
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );

  constructor() {
    void this.loadPage();
    void this.loadCountries();
  }

  /** Country filter options; the filter still offers "Unknown" without them. */
  private async loadCountries(): Promise<void> {
    try {
      this.countries.set((await this.users.countries()).items);
    } catch {
      this.countries.set([]);
    }
  }

  protected countryLabel(code: string | null | undefined): string | null {
    return countryName(code, this.i18n.currentLocale());
  }

  protected reload(): void {
    void this.loadPage();
  }

  private async loadPage(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const role = this.role();
      const sub = this.subscription();
      const res = await this.users.list({
        skip: (this.page() - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        ...(this.query() ? { q: this.query() } : {}),
        ...(role ? { role } : {}),
        ...(this.locale() ? { locale: this.locale() } : {}),
        ...lastSeenRange(this.lastSeen()),
        ...(sub ? { subscriptionStatus: sub } : {}),
        ...(this.country() ? { country: this.country() } : {}),
      });
      if (seq !== this.seq) return;
      this.pageRows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      if (seq === this.seq) this.loadError.set(err);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  protected onSearch(q: string): void {
    this.query.set(q.trim());
    this.page.set(1);
    void this.loadPage();
  }

  protected onRole(role: ApiUserRole | ''): void {
    this.role.set(role);
    this.page.set(1);
    void this.loadPage();
  }

  protected onFilter<T>(target: { set(v: T): void }, value: T): void {
    target.set(value);
    this.page.set(1);
    void this.loadPage();
  }

  protected goTo(p: number): void {
    this.page.set(p);
    void this.loadPage();
  }
}
