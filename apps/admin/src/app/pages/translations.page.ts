import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  ContentTranslationService,
  I18nService,
  LocalePipe,
  TranslatePipe,
} from '@codify/i18n';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import {
  Badge,
  type BadgeVariant,
  Button,
  EmptyState,
  FormField,
  LessonBlockEditor,
  LessonBlockRenderer,
  Pagination,
  SearchBar,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  TranslationsClient,
  type ContentLocale,
  type TranslatableEntityType,
  type TranslationCompleteness,
  type TranslationRow,
  type TranslationStatus,
  type TranslationUpsert,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { type HasUnsavedChanges, warnOnUnload } from '../core/unsaved-changes';
import { EditorDocBinding } from '../core/editor-doc';

const PAGE_SIZE = 20;
const ENTITY_TYPES: readonly TranslatableEntityType[] = [
  'COURSE',
  'MODULE',
  'LESSON',
  'CATEGORY',
];
const LOCALES: readonly ContentLocale[] = ['pt-BR', 'en-US'];
const STATUS_VARIANT: Record<TranslationStatus, BadgeVariant> = {
  missing: 'danger',
  outdated: 'warning',
  done: 'success',
};

export function rowKey(
  r: Pick<TranslationRow, 'entityType' | 'entityId' | 'field' | 'locale'>,
): string {
  return `${r.entityType}|${r.entityId}|${r.field}|${r.locale}`;
}

/** Parse a stored contentJson string into a LessonDoc (empty doc when blank/invalid). */
export function parseDoc(value: string | null | undefined): LessonDoc {
  if (!value) return emptyLessonDoc();
  try {
    const doc = JSON.parse(value) as LessonDoc;
    return doc && doc.type === 'doc' ? doc : emptyLessonDoc();
  } catch {
    return emptyLessonDoc();
  }
}

/** Edited values → upsert payload (skips values identical to what's stored). */
export function buildUpserts(
  rows: readonly TranslationRow[],
  edits: ReadonlyMap<string, string>,
): TranslationUpsert[] {
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  const out: TranslationUpsert[] = [];
  for (const [key, value] of edits) {
    const row = byKey.get(key);
    if (!row || value === (row.value ?? '') || !value.trim()) continue;
    out.push({
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field,
      locale: row.locale as ContentLocale,
      value,
    });
  }
  return out;
}

/**
 * Translation workspace (docs/11): completeness per locale × entity type,
 * filterable / searchable / paginated rows with the source next to the
 * translation (lesson bodies edited in the LessonBlockEditor), outdated
 * badges and one bulk save for every edited row.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    Badge,
    Button,
    EmptyState,
    FormField,
    LessonBlockEditor,
    LessonBlockRenderer,
    Pagination,
    SearchBar,
    Select,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.translations.title' | translate }}</h1>
          <p class="muted">{{ 'admin.translations.subtitle' | translate }}</p>
        </div>
        <div class="page-head__actions">
          <cdf-button
            kind="primary"
            [disabled]="pendingCount() === 0"
            [loading]="saving()"
            (click)="saveAll()"
            data-testid="save-translations"
          >
            {{
              'admin.translations.saveAll'
                | translate: { count: pendingCount() }
            }}
          </cdf-button>
        </div>
      </header>

      <section class="admin-card" aria-labelledby="completeness-title">
        <h2 id="completeness-title">
          {{ 'admin.translations.completeness' | translate }}
        </h2>
        @if (completeness(); as c) {
          <div class="table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th scope="col">
                    {{ 'admin.translations.locale' | translate }}
                  </th>
                  @for (t of entityTypesAll; track t) {
                    <th scope="col" class="num">
                      {{ 'admin.translations.types.' + t | translate }}
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (loc of completenessLocales(c); track loc) {
                  <tr>
                    <th scope="row">{{ loc }}</th>
                    @for (t of entityTypesAll; track t) {
                      <td class="num">
                        @if (c.locales[loc]?.[t]; as n) {
                          <strong>{{ n.pct / 100 | locale: 'percent' }}</strong>
                          <div class="muted small">
                            {{
                              'admin.translations.counts'
                                | translate
                                  : { done: n.translated, total: n.total }
                            }}
                            @if (n.outdated > 0) {
                              ·
                              {{
                                'admin.translations.outdatedCount'
                                  | translate: { count: n.outdated }
                              }}
                            }
                          </div>
                        } @else {
                          —
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <cdf-skeleton shape="rect" height="80px" />
        }
      </section>

      <div class="filters">
        <cdf-form-field
          [label]="'admin.translations.entityType' | translate"
          controlId="tr-type"
        >
          <cdf-select
            inputId="tr-type"
            [options]="typeOptions()"
            [ngModel]="entityType()"
            (ngModelChange)="setFilter('type', $event)"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.translations.locale' | translate"
          controlId="tr-locale"
        >
          <cdf-select
            inputId="tr-locale"
            [options]="localeOptions"
            [ngModel]="locale()"
            (ngModelChange)="setFilter('locale', $event)"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.common.status' | translate"
          controlId="tr-status"
        >
          <cdf-select
            inputId="tr-status"
            [options]="statusOptions()"
            [ngModel]="status()"
            (ngModelChange)="setFilter('status', $event)"
          />
        </cdf-form-field>
        <cdf-search-bar
          class="search"
          [placeholder]="'admin.translations.search' | translate"
          [ariaLabel]="'admin.translations.search' | translate"
          (query)="setFilter('q', $event)"
        />
      </div>
      <p class="muted small" aria-live="polite">
        {{
          'admin.common.showing'
            | translate: { shown: rows().length, total: total() }
        }}
      </p>

      @if (loading()) {
        <cdf-skeleton shape="rect" height="240px" />
      } @else if (rows().length === 0) {
        <cdf-empty-state
          icon="translate"
          [title]="'admin.translations.emptyTitle' | translate"
          [description]="'admin.common.emptyFilter' | translate"
        />
      } @else {
        <ul class="plain-list rows">
          @for (r of rows(); track key(r)) {
            <li class="row admin-card" [attr.data-row]="key(r)">
              <header class="row__head">
                <cdf-badge variant="neutral" [subtle]="true">{{
                  'admin.translations.types.' + r.entityType | translate
                }}</cdf-badge>
                <strong>{{ r.label }}</strong>
                <span class="muted small">{{
                  'admin.translations.fields.' + r.field | translate
                }}</span>
                <cdf-badge
                  [variant]="statusVariant[r.status]"
                  [subtle]="true"
                  >{{
                    'admin.translations.statuses.' + r.status | translate
                  }}</cdf-badge
                >
                @if (r.outdated) {
                  <cdf-badge variant="warning">{{
                    'admin.translations.outdated' | translate
                  }}</cdf-badge>
                }
                @if (isEdited(r)) {
                  <cdf-badge variant="info" [subtle]="true">{{
                    'admin.translations.edited' | translate
                  }}</cdf-badge>
                }
                @if (r.updatedAt) {
                  <span class="muted small push">{{
                    r.updatedAt | locale: 'relative'
                  }}</span>
                }
              </header>
              @if (r.field === 'contentJson') {
                @if (openDoc() === key(r)) {
                  <div class="pair">
                    <div class="side">
                      <h3>
                        {{
                          'admin.translations.source'
                            | translate: { locale: r.sourceLocale }
                        }}
                      </h3>
                      <cdf-lesson-block-renderer [doc]="sourceDoc(r)" />
                    </div>
                    <div class="side">
                      <h3>
                        {{
                          'admin.translations.translation'
                            | translate: { locale: r.locale }
                        }}
                      </h3>
                      <cdf-lesson-block-editor
                        [formControl]="docBinding.control"
                      />
                    </div>
                  </div>
                  <cdf-button
                    kind="ghost"
                    size="sm"
                    (click)="openDoc.set(null)"
                    >{{ 'admin.translations.collapse' | translate }}</cdf-button
                  >
                } @else {
                  <cdf-button
                    kind="secondary"
                    size="sm"
                    (click)="openEditor(r)"
                  >
                    {{ 'admin.translations.editContent' | translate }}
                  </cdf-button>
                }
              } @else {
                <div class="pair">
                  <div class="side">
                    <span class="side__label" [id]="key(r) + '-src'">{{
                      'admin.translations.source'
                        | translate: { locale: r.sourceLocale }
                    }}</span>
                    <p class="source">{{ r.sourceValue }}</p>
                  </div>
                  <div class="side">
                    <label class="side__label" [for]="key(r) + '-val'">{{
                      'admin.translations.translation'
                        | translate: { locale: r.locale }
                    }}</label>
                    <textarea
                      class="form-control"
                      [id]="key(r) + '-val'"
                      [rows]="r.field === 'description' ? 3 : 1"
                      [attr.aria-describedby]="key(r) + '-src'"
                      [ngModel]="valueFor(r)"
                      (ngModelChange)="edit(r, $event)"
                    ></textarea>
                  </div>
                </div>
              }
            </li>
          }
        </ul>
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
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
      .search {
        flex: 1 1 260px;
      }
      .rows .row {
        margin-bottom: var(--cdf-space-3);
      }
      .row__head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .push {
        margin-left: auto;
      }
      .pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--cdf-space-3);
      }
      @media (max-width: 860px) {
        .pair {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .side h3,
      .side__label {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
        margin: 0 0 4px;
      }
      .source {
        margin: 0;
        padding: 8px;
        background: var(--cdf-color-bg);
        border-radius: var(--cdf-radius-sm);
        white-space: pre-wrap;
      }
    `,
  ],
})
export class TranslationsPage implements HasUnsavedChanges {
  private readonly client = inject(TranslationsClient);
  private readonly content = inject(ContentTranslationService);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly statusVariant = STATUS_VARIANT;
  protected readonly entityTypesAll = [...ENTITY_TYPES, 'ALL'] as const;
  protected readonly localeOptions: SelectOption<ContentLocale>[] = LOCALES.map(
    (l) => ({ value: l, label: l }),
  );

  protected readonly entityType = signal<TranslatableEntityType | ''>('');
  protected readonly locale = signal<ContentLocale>(
    this.i18n.currentLocale() === 'pt-BR' ? 'en-US' : 'pt-BR',
  );
  protected readonly status = signal<TranslationStatus | ''>('');
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly rows = signal<TranslationRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly completeness = signal<TranslationCompleteness | null>(
    null,
  );
  protected readonly openDoc = signal<string | null>(null);
  private openRow: TranslationRow | null = null;
  protected readonly docBinding = new EditorDocBinding(
    (doc) => {
      if (this.openRow) this.editDoc(this.openRow, doc);
    },
    (doc) => {
      if (this.openRow) this.docCache.set(`tr|${rowKey(this.openRow)}`, doc);
    },
  );
  /** rowKey → edited value (kept across pages until saved). */
  private readonly edits = signal<Map<string, string>>(new Map());
  /** Rows seen with edits, so edits on other pages can still be saved. */
  private readonly editedRows = new Map<string, TranslationRow>();
  private readonly docCache = new Map<string, LessonDoc>();
  private seq = 0;

  protected readonly pendingCount = computed(
    () => buildUpserts([...this.editedRows.values()], this.edits()).length,
  );
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );
  protected readonly typeOptions = computed<
    SelectOption<TranslatableEntityType | ''>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.translations.allTypes') },
      ...ENTITY_TYPES.map((t) => ({
        value: t,
        label: this.i18n.t(`admin.translations.types.${t}`),
      })),
    ];
  });
  protected readonly statusOptions = computed<
    SelectOption<TranslationStatus | ''>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.translations.allStatuses') },
      ...(['missing', 'outdated', 'done'] as const).map((s) => ({
        value: s,
        label: this.i18n.t(`admin.translations.statuses.${s}`),
      })),
    ];
  });

  constructor() {
    warnOnUnload(() => this.pendingCount() > 0);
    void this.load();
    void this.loadCompleteness();
  }

  hasUnsavedChanges(): boolean {
    return this.pendingCount() > 0;
  }

  protected key(r: TranslationRow): string {
    return rowKey(r);
  }

  protected completenessLocales(c: TranslationCompleteness): string[] {
    return Object.keys(c.locales);
  }

  protected setFilter(
    kind: 'type' | 'locale' | 'status' | 'q',
    value: string | null,
  ): void {
    const v = value ?? '';
    if (kind === 'type') this.entityType.set(v as TranslatableEntityType | '');
    if (kind === 'locale' && v) this.locale.set(v as ContentLocale);
    if (kind === 'status') this.status.set(v as TranslationStatus | '');
    if (kind === 'q') this.q.set(v.trim());
    this.page.set(1);
    void this.load();
  }

  protected goTo(p: number): void {
    this.page.set(p);
    void this.load();
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const res = await this.client.list({
        entityType: this.entityType() || undefined,
        locale: this.locale(),
        status: this.status() || undefined,
        q: this.q() || undefined,
        limit: PAGE_SIZE,
        offset: (this.page() - 1) * PAGE_SIZE,
      });
      if (seq !== this.seq) return; // a newer filter won
      this.rows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      if (seq === this.seq)
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  private async loadCompleteness(): Promise<void> {
    try {
      this.completeness.set(await this.client.completeness());
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected isEdited(r: TranslationRow): boolean {
    const v = this.edits().get(rowKey(r));
    return v !== undefined && v !== (r.value ?? '');
  }

  protected valueFor(r: TranslationRow): string {
    return this.edits().get(rowKey(r)) ?? r.value ?? '';
  }

  protected edit(r: TranslationRow, value: string): void {
    const k = rowKey(r);
    this.editedRows.set(k, r);
    this.edits.update((m) => new Map(m).set(k, value));
  }

  protected sourceDoc(r: TranslationRow): LessonDoc {
    return this.cachedDoc(`src|${rowKey(r)}`, () => parseDoc(r.sourceValue));
  }

  /** Stable doc object for the editor (re-parsing per CD would reset it). */
  protected docFor(r: TranslationRow): LessonDoc {
    return this.cachedDoc(`tr|${rowKey(r)}`, () =>
      parseDoc(this.valueFor(r) || r.sourceValue),
    );
  }

  private cachedDoc(key: string, make: () => LessonDoc): LessonDoc {
    let doc = this.docCache.get(key);
    if (!doc) {
      doc = make();
      this.docCache.set(key, doc);
    }
    return doc;
  }

  /** Open the lesson-body editor for one row (one at a time). */
  protected openEditor(r: TranslationRow): void {
    this.openRow = r;
    this.docBinding.reset(this.docFor(r));
    this.openDoc.set(rowKey(r));
  }

  protected editDoc(r: TranslationRow, doc: LessonDoc): void {
    this.docCache.set(`tr|${rowKey(r)}`, doc);
    this.edit(r, JSON.stringify(doc));
  }

  protected async saveAll(): Promise<void> {
    const items = buildUpserts([...this.editedRows.values()], this.edits());
    if (items.length === 0) return;
    this.saving.set(true);
    try {
      const res = await this.client.upsert(items);
      for (const it of items)
        this.content.invalidate(it.entityType, it.entityId);
      this.edits.set(new Map());
      this.editedRows.clear();
      this.docCache.clear();
      this.toast.success(
        this.i18n.t('admin.translations.saved', { count: res.updated }),
      );
      void this.load();
      void this.loadCompleteness();
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }
}
