import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Icon,
  Input,
  Pagination,
  Skeleton,
  ToastService,
  type CursorPageEvent,
} from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  type AuditEntry,
  type AuditQuery,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { diffRows, filterBoundToIso, type DiffRow } from '../core/audit-diff';
import { CursorPager } from '../core/cursor-pager';
import { LoadError } from '../shared/load-error';

const PAGE_SIZE = 50;

interface AuditFilters {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  actorId: '',
  action: '',
  entityType: '',
  entityId: '',
  from: '',
  to: '',
};

/** Filters → API query (blank fields dropped, dates as ISO bounds). */
export function auditQueryFrom(f: AuditFilters): AuditQuery {
  const q: AuditQuery = {};
  if (f.actorId.trim()) q.actorId = f.actorId.trim();
  if (f.action.trim()) q.action = f.action.trim();
  if (f.entityType.trim()) q.entityType = f.entityType.trim();
  if (f.entityId.trim()) q.entityId = f.entityId.trim();
  const from = filterBoundToIso(f.from, 'start');
  const to = filterBoundToIso(f.to, 'end');
  if (from) q.from = from;
  if (to) q.to = to;
  return q;
}

/**
 * Audit log (docs/04 "Audit"): filter by actor, action (prefix), entity
 * and time; keyset paging; a per-row diff viewer; CSV export of the same
 * filters (row-capped server-side). TEACHER callers only see their own
 * actions — the API enforces it, the page explains it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    Button,
    EmptyState,
    FormField,
    Icon,
    Input,
    LoadError,
    Pagination,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.audit.title' | translate }}</h1>
          <p class="muted">
            {{
              (isTeacher() ? 'admin.audit.subtitleOwn' : 'admin.audit.subtitle')
                | translate
            }}
          </p>
        </div>
        <div class="page-head__actions">
          <cdf-button
            kind="secondary"
            [loading]="exporting()"
            (click)="exportCsv()"
            data-testid="audit-export"
          >
            <cdf-icon name="upload" size="sm" />
            {{ 'admin.audit.export' | translate }}
          </cdf-button>
        </div>
      </header>

      <form class="admin-card filters-card" (submit)="apply($event)">
        <div class="form-grid">
          @if (!isTeacher()) {
            <cdf-form-field
              [label]="'admin.audit.actor' | translate"
              controlId="audit-actor"
              [help]="'admin.audit.actorHelp' | translate"
            >
              <cdf-input
                inputId="audit-actor"
                name="actorId"
                [(ngModel)]="draft.actorId"
              />
            </cdf-form-field>
          }
          <cdf-form-field
            [label]="'admin.audit.action' | translate"
            controlId="audit-action"
            [help]="'admin.audit.actionHelp' | translate"
          >
            <cdf-input
              inputId="audit-action"
              name="action"
              [(ngModel)]="draft.action"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.audit.entityType' | translate"
            controlId="audit-entity"
          >
            <cdf-input
              inputId="audit-entity"
              name="entityType"
              [(ngModel)]="draft.entityType"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.audit.entityId' | translate"
            controlId="audit-entity-id"
          >
            <cdf-input
              inputId="audit-entity-id"
              name="entityId"
              [(ngModel)]="draft.entityId"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.audit.from' | translate"
            controlId="audit-from"
          >
            <input
              id="audit-from"
              name="from"
              type="date"
              class="form-control"
              [(ngModel)]="draft.from"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.audit.to' | translate"
            controlId="audit-to"
          >
            <input
              id="audit-to"
              name="to"
              type="date"
              class="form-control"
              [(ngModel)]="draft.to"
            />
          </cdf-form-field>
        </div>
        <div class="form-actions">
          <cdf-button kind="primary" type="submit">{{
            'admin.audit.apply' | translate
          }}</cdf-button>
          <cdf-button kind="ghost" (click)="clear()">{{
            'admin.audit.clear' | translate
          }}</cdf-button>
        </div>
      </form>

      @if (error(); as e) {
        <cdf-load-error [message]="e" (retry)="reload()" />
      } @else if (loading() && rows().length === 0) {
        <cdf-skeleton shape="rect" height="280px" />
      } @else if (rows().length === 0) {
        <cdf-empty-state
          icon="file"
          [title]="'admin.audit.emptyTitle' | translate"
          [description]="'admin.common.emptyFilter' | translate"
        >
          <cdf-button kind="secondary" (click)="clear()">{{
            'admin.audit.clear' | translate
          }}</cdf-button>
        </cdf-empty-state>
      } @else {
        <div
          class="admin-card table-scroll"
          [attr.aria-busy]="loading()"
          data-testid="audit-table"
        >
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">{{ 'admin.audit.when' | translate }}</th>
                <th scope="col">{{ 'admin.audit.actor' | translate }}</th>
                <th scope="col">{{ 'admin.audit.action' | translate }}</th>
                <th scope="col">{{ 'admin.audit.entity' | translate }}</th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.audit.diff' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (e of rows(); track e.id) {
                <tr>
                  <td class="small nowrap">
                    <time [attr.datetime]="e.createdAt">{{
                      e.createdAt | locale: 'datetime'
                    }}</time>
                  </td>
                  <td>
                    @if (e.actorId) {
                      {{ e.actorName ?? e.actorId }}
                      <div class="muted small">
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
                  <td class="small">
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
                  </td>
                  <td>
                    @if (e.diff !== null) {
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        [attr.aria-expanded]="expanded() === e.id"
                        [attr.aria-controls]="'diff-' + e.id"
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
                    <td colspan="5" [id]="'diff-' + e.id">
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
export class AuditPage {
  private readonly client = inject(AdminOpsClient);
  private readonly errors = inject(AdminErrors);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected readonly isTeacher = computed(() => this.auth.role() === 'TEACHER');
  protected draft: AuditFilters = { ...EMPTY_FILTERS };
  private applied: AuditFilters = { ...EMPTY_FILTERS };
  protected readonly pager = new CursorPager();
  protected readonly rows = signal<AuditEntry[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);
  private readonly diffCache = new Map<string, DiffRow[]>();
  private seq = 0;

  constructor() {
    // Deep links: /audit?entityType=User&entityId=… (e.g. from a user page).
    const qp = this.route.snapshot.queryParamMap;
    for (const k of Object.keys(EMPTY_FILTERS) as (keyof AuditFilters)[])
      this.draft[k] = qp.get(k) ?? '';
    this.applied = { ...this.draft };
    void this.load(undefined);
  }

  protected apply(ev?: Event): void {
    ev?.preventDefault();
    this.applied = { ...this.draft };
    this.pager.reset();
    void this.load(undefined);
  }

  protected clear(): void {
    this.draft = { ...EMPTY_FILTERS };
    this.apply();
  }

  protected reload(): void {
    void this.load(this.pager.current);
  }

  protected onPage(ev: CursorPageEvent): void {
    const cursor =
      ev.direction === 'next' && ev.cursor
        ? this.pager.forward(ev.cursor)
        : this.pager.back();
    void this.load(cursor);
  }

  private async load(cursor: string | undefined): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.client.audit({
        ...auditQueryFrom(this.applied),
        ...(cursor ? { cursor } : {}),
        limit: PAGE_SIZE,
      });
      if (seq !== this.seq) return;
      this.rows.set(res.items);
      this.nextCursor.set(res.nextCursor);
      this.page.set(this.pager.page);
      this.expanded.set(null);
    } catch (err) {
      if (seq === this.seq)
        this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
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

  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const out = await this.client.auditExport(auditQueryFrom(this.applied));
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (out.truncated)
        this.toast.warn(
          this.i18n.t('admin.audit.truncated', { rows: out.rows }),
        );
      else
        this.toast.success(
          this.i18n.t('admin.audit.exported', { rows: out.rows }),
        );
    } catch (err) {
      this.errors.toast(err, 'admin.audit.exportFailed');
    } finally {
      this.exporting.set(false);
    }
  }
}
