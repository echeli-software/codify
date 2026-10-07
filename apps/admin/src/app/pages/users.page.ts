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
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';

const PAGE_SIZE = 25;
/** Upper bound of users loaded for a search (the API has no `q` filter yet). */
export const SEARCH_SCAN_LIMIT = 500;

export function matchesUser(u: AdminUserListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    u.email.toLowerCase().includes(needle) ||
    u.displayName.toLowerCase().includes(needle) ||
    u.id.toLowerCase() === needle
  );
}

/**
 * Users (docs/04): paginated list with search and role filter, linking to
 * the user detail (profile, subscriptions, enrollments). ADMIN + SUPPORT.
 * Search scans up to SEARCH_SCAN_LIMIT users client-side until the API
 * grows a query parameter.
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
            (ngModelChange)="role.set($event ?? ''); page.set(1)"
          />
        </cdf-form-field>
      </div>
      <p class="muted small" aria-live="polite">
        @if (query()) {
          {{
            'admin.users.searchResults'
              | translate: { count: filtered().length, scanned: scanned() }
          }}
        } @else {
          {{
            'admin.common.showing'
              | translate: { shown: visible().length, total: total() }
          }}
        }
      </p>

      @if (loading()) {
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
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly loading = signal(true);
  protected readonly pageRows = signal<AdminUserListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly query = signal('');
  protected readonly role = signal<ApiUserRole | ''>('');
  /** Users loaded for search (null until a search runs). */
  private readonly scan = signal<AdminUserListItem[] | null>(null);
  protected readonly scanned = computed(() => this.scan()?.length ?? 0);
  private seq = 0;

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

  /** Search results (client-side over the scan) or the current page. */
  protected readonly filtered = computed(() => {
    const role = this.role();
    const source = this.query() ? (this.scan() ?? []) : this.pageRows();
    return source.filter(
      (u) => (!role || u.role === role) && matchesUser(u, this.query()),
    );
  });
  protected readonly visible = computed(() => {
    if (!this.query()) return this.filtered();
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });
  protected readonly totalPages = computed(() =>
    Math.max(
      1,
      Math.ceil(
        (this.query() ? this.filtered().length : this.total()) / PAGE_SIZE,
      ),
    ),
  );

  constructor() {
    void this.loadPage();
  }

  private async loadPage(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const res = await this.users.list({
        skip: (this.page() - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      if (seq !== this.seq) return;
      this.pageRows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      if (seq === this.seq)
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  private async loadScan(): Promise<void> {
    if (this.scan()) return;
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const all: AdminUserListItem[] = [];
      for (let skip = 0; skip < SEARCH_SCAN_LIMIT; skip += 100) {
        const res = await this.users.list({ skip, take: 100 });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
      }
      if (seq === this.seq) this.scan.set(all);
    } catch (err) {
      if (seq === this.seq)
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  protected onSearch(q: string): void {
    this.query.set(q.trim());
    this.page.set(1);
    if (this.query()) void this.loadScan();
    else void this.loadPage();
  }

  protected goTo(p: number): void {
    this.page.set(p);
    if (!this.query()) void this.loadPage();
  }
}
