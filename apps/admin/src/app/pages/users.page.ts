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

/**
 * Users (docs/04): paginated list with server-side search (email, name or
 * id) and role filter, linking to the user detail (profile, subscriptions,
 * enrollments). ADMIN + SUPPORT.
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
            (ngModelChange)="onRole($event ?? '')"
          />
        </cdf-form-field>
      </div>
      <p class="muted small" aria-live="polite">
        @if (query()) {
          {{ 'admin.users.searchResults' | translate: { count: total() } }}
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

  protected readonly visible = this.pageRows.asReadonly();
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );

  constructor() {
    void this.loadPage();
  }

  private async loadPage(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const role = this.role();
      const res = await this.users.list({
        skip: (this.page() - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        ...(this.query() ? { q: this.query() } : {}),
        ...(role ? { role } : {}),
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

  protected goTo(p: number): void {
    this.page.set(p);
    void this.loadPage();
  }
}
