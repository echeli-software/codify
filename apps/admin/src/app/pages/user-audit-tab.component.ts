import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Badge,
  Button,
  EmptyState,
  Pagination,
  Skeleton,
  type CursorPageEvent,
} from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  type AuditEntry,
  type AuditQuery,
} from '@codify/api-client';
import { diffRows, type DiffRow } from '../core/audit-diff';
import { CursorPager } from '../core/cursor-pager';
import { LoadError } from '../core/load-error';

/** Which side of the audit log the tab lists. */
export type UserAuditScope = 'about' | 'actions';

const PAGE_SIZE = 25;

/**
 * Audit query for a user's tab: entries about the user (`User` rows with
 * the user's id) or, for staff users, the actions they performed. The API
 * still forces a TEACHER caller's own actor id (docs/04 §1).
 */
export function userAuditQuery(
  userId: string,
  scope: UserAuditScope,
): AuditQuery {
  return scope === 'actions'
    ? { actorId: userId }
    : { entityType: 'User', entityId: userId };
}

/**
 * STF-8: the user detail "Audit" tab (docs/04 Users). Keyset-paged, with
 * the audit page's per-row before/after viewer and a link to the full log
 * with the same filter.
 */
@Component({
  selector: 'cdf-user-audit-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Badge,
    Button,
    EmptyState,
    LoadError,
    Pagination,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-card" data-testid="user-audit">
      <header class="section-head">
        <h2>{{ 'admin.users.audit.title' | translate }}</h2>
        <a
          [routerLink]="['/audit']"
          [queryParams]="logQuery()"
          data-testid="user-audit-open-log"
          >{{ 'admin.users.audit.openLog' | translate }}</a
        >
      </header>
      @if (staff()) {
        <div
          class="seg"
          role="group"
          [attr.aria-label]="'admin.users.audit.scope' | translate"
        >
          @for (s of scopes; track s) {
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-primary]="scope() === s"
              [class.btn-outline-primary]="scope() !== s"
              [attr.aria-pressed]="scope() === s"
              [attr.data-audit-scope]="s"
              (click)="setScope(s)"
            >
              {{ 'admin.users.audit.' + s | translate }}
            </button>
          }
        </div>
      }
      @if (viewerIsTeacher()) {
        <p class="muted small">{{ 'admin.audit.subtitleOwn' | translate }}</p>
      }

      @if (error(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="reload()" />
      } @else if (rows() === null) {
        <cdf-skeleton shape="rect" height="160px" />
      } @else if (rows()!.length === 0) {
        <cdf-empty-state
          icon="file"
          [title]="
            (scope() === 'actions'
              ? 'admin.users.audit.emptyActions'
              : 'admin.users.audit.empty'
            ) | translate
          "
        />
      } @else {
        <div class="table-scroll">
          <table class="admin-table" data-testid="user-audit-table">
            <thead>
              <tr>
                <th scope="col">{{ 'admin.audit.when' | translate }}</th>
                <th scope="col">
                  {{
                    (scope() === 'actions'
                      ? 'admin.audit.entity'
                      : 'admin.audit.actor'
                    ) | translate
                  }}
                </th>
                <th scope="col">{{ 'admin.audit.action' | translate }}</th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.audit.diff' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (e of rows(); track e.id) {
                <tr [attr.data-audit]="e.id">
                  <td class="small nowrap">
                    <time [attr.datetime]="e.createdAt">{{
                      e.createdAt | locale: 'datetime'
                    }}</time>
                  </td>
                  <td class="small">
                    @if (scope() === 'actions') {
                      @if (e.entity) {
                        {{ e.entity }}
                        <div class="mono muted">
                          @if (e.entity === 'User' && e.entityId) {
                            <a [routerLink]="['/users', e.entityId]">{{
                              e.entityId
                            }}</a>
                          } @else {
                            {{ e.entityId }}
                          }
                        </div>
                      }
                    } @else if (e.actorId) {
                      {{ e.actorName ?? e.actorId }}
                      <div class="muted">
                        {{ e.actorEmail }}
                        @if (e.actorRole) {
                          · {{ 'admin.roles.' + e.actorRole | translate }}
                        }
                      </div>
                    } @else {
                      <span class="muted">{{
                        'admin.audit.system' | translate
                      }}</span>
                    }
                  </td>
                  <td>
                    <cdf-badge variant="neutral" [subtle]="true"
                      ><span class="mono">{{ e.action }}</span></cdf-badge
                    >
                  </td>
                  <td>
                    @if (e.diff !== null) {
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        [attr.aria-expanded]="expanded() === e.id"
                        [attr.aria-controls]="'udiff-' + e.id"
                        (click)="toggle(e.id)"
                        >{{
                          (expanded() === e.id
                            ? 'admin.audit.hideDiff'
                            : 'admin.audit.showDiff'
                          ) | translate
                        }}</cdf-button
                      >
                    }
                  </td>
                </tr>
                @if (expanded() === e.id) {
                  <tr class="diff-row">
                    <td colspan="4" [id]="'udiff-' + e.id">
                      <table class="admin-table diff-table">
                        <caption class="visually-hidden">
                          {{
                            'admin.audit.diffCaption'
                              | translate: { action: e.action }
                          }}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">
                              {{ 'admin.audit.field' | translate }}
                            </th>
                            <th scope="col">
                              {{ 'admin.audit.before' | translate }}
                            </th>
                            <th scope="col">
                              {{ 'admin.audit.after' | translate }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (d of diffFor(e); track d.field) {
                            <tr [class.changed]="d.changed">
                              <th scope="row" class="mono">{{ d.field }}</th>
                              <td class="mono">
                                {{
                                  d.before ?? ('admin.common.none' | translate)
                                }}
                              </td>
                              <td class="mono">
                                {{
                                  d.after ?? ('admin.common.none' | translate)
                                }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                      @if (e.ip || e.userAgent) {
                        <p class="muted small meta">
                          {{
                            'admin.audit.origin'
                              | translate
                                : {
                                    ip: e.ip ?? '—',
                                    agent: e.userAgent ?? '—',
                                  }
                          }}
                        </p>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        <cdf-pagination
          mode="cursor"
          [prevCursor]="null"
          [canGoBack]="pager.canGoBack"
          [nextCursor]="nextCursor()"
          [pageLabel]="'admin.audit.page' | translate: { page: page() }"
          (cursorChange)="onPage($event)"
        />
      }
    </div>
  `,
  styles: [
    `
      .seg {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: var(--cdf-space-2);
      }
      /* Keep the visually-hidden header text inside the scroll box. */
      .table-scroll {
        position: relative;
      }
      .nowrap {
        white-space: nowrap;
      }
      .diff-row > td {
        background: var(--cdf-color-surface-raised, var(--cdf-color-bg));
      }
      .diff-table {
        font-size: 13px;
      }
      .diff-table td {
        overflow-wrap: anywhere;
        max-width: 420px;
      }
      .diff-table tr.changed td:last-child {
        color: var(--cdf-color-success);
        font-weight: 600;
      }
      .meta {
        margin: var(--cdf-space-2) 0 0;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class UserAuditTab {
  private readonly client = inject(AdminOpsClient);
  private readonly auth = inject(AuthService);

  /** The user whose page this is. */
  readonly userId = input.required<string>();
  /** Staff users also get "Actions by this user". */
  readonly staff = input(false);

  protected readonly scopes: readonly UserAuditScope[] = ['about', 'actions'];
  protected readonly scope = signal<UserAuditScope>('about');
  protected readonly viewerIsTeacher = computed(
    () => this.auth.role() === 'TEACHER',
  );
  protected readonly rows = signal<AuditEntry[] | null>(null);
  protected readonly error = signal<unknown>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly expanded = signal<string | null>(null);
  protected readonly pager = new CursorPager();
  protected readonly logQuery = computed(() =>
    userAuditQuery(this.userId(), this.scope()),
  );
  private readonly diffCache = new Map<string, DiffRow[]>();
  private seq = 0;

  constructor() {
    effect(() => {
      const id = this.userId();
      const staff = this.staff();
      untracked(() => {
        if (!staff) this.scope.set('about');
        this.pager.reset();
        void this.load(id, undefined);
      });
    });
  }

  protected setScope(s: UserAuditScope): void {
    if (this.scope() === s) return;
    this.scope.set(s);
    this.pager.reset();
    void this.load(this.userId(), undefined);
  }

  protected reload(): void {
    void this.load(this.userId(), this.pager.current);
  }

  protected onPage(ev: CursorPageEvent): void {
    const cursor =
      ev.direction === 'next' && ev.cursor
        ? this.pager.forward(ev.cursor)
        : this.pager.back();
    void this.load(this.userId(), cursor);
  }

  protected toggle(id: string): void {
    this.expanded.update((cur) => (cur === id ? null : id));
  }

  protected diffFor(e: AuditEntry): DiffRow[] {
    let rows = this.diffCache.get(e.id);
    if (!rows) {
      rows = diffRows(e.diff);
      this.diffCache.set(e.id, rows);
    }
    return rows;
  }

  private async load(userId: string, cursor: string | undefined) {
    const seq = ++this.seq;
    this.error.set(null);
    this.rows.set(null);
    this.expanded.set(null);
    try {
      const res = await this.client.audit({
        ...userAuditQuery(userId, this.scope()),
        ...(cursor ? { cursor } : {}),
        limit: PAGE_SIZE,
      });
      if (seq !== this.seq) return;
      this.rows.set(res.items);
      this.nextCursor.set(res.nextCursor);
      this.page.set(this.pager.page);
    } catch (err) {
      if (seq === this.seq) this.error.set(err);
    }
  }
}
