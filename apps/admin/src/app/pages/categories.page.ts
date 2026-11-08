import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDropList,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Badge,
  Button,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  CategoriesClient,
  PlansClient,
  type Category,
  type Plan,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES } from '../core/roles';
import { moveItem, tokenColor } from '../core/catalog';
import { DirtyTracker } from '../core/dirty';
import { LoadError } from '../core/load-error';
import type { HasUnsavedChanges } from '../core/unsaved-changes';

interface FormState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  iconName: string;
  colorToken: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  name: '',
  description: '',
  iconName: '',
  colorToken: '',
};

/** ui-tokens colours a category may use (`--cdf-color-<token>`). */
export const CATEGORY_COLOR_TOKENS = [
  'primary',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
  'coin',
  'xp',
  'premium',
  'flame',
] as const;

const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Catalog → Categories (docs/04): the taxonomy used to tag courses, filter
 * the student catalog and bind plans. Drag (or move up / down) to set the
 * catalog order (`sortOrder`), colour swatches, a translations shortcut per
 * category, and plan assignment from the selected category. ADMIN edits;
 * SUPPORT gets a read-only list.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    Badge,
    Button,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    LoadError,
    Select,
    Skeleton,
    Toggle,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.categories.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.categories.subtitle' | translate }}
            <a routerLink="/plans">{{
              'admin.categories.plansLink' | translate
            }}</a>
          </p>
        </div>
        @if (canEdit()) {
          <cdf-button kind="primary" (click)="startCreate()">
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.categories.new' | translate }}
          </cdf-button>
        }
      </header>

      <div [class.split]="canEdit()">
        <section class="admin-card">
          <h2>
            {{ 'admin.categories.count' | translate: { count: rows().length } }}
          </h2>
          @if (canEdit() && rows().length > 1) {
            <p class="muted small">
              {{ 'admin.categories.reorderHelp' | translate }}
            </p>
          }
          <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>
          @if (loadError(); as err) {
            <cdf-admin-load-error [error]="err" (retry)="refresh()" />
          } @else if (loading()) {
            <cdf-skeleton shape="rect" height="160px" />
          } @else if (rows().length === 0) {
            <cdf-empty-state
              icon="folder-open"
              [title]="'admin.categories.emptyTitle' | translate"
              [description]="'admin.categories.emptyDescription' | translate"
            >
              @if (canEdit()) {
                <cdf-button kind="primary" (click)="startCreate()">
                  <cdf-icon name="plus" size="sm" />
                  {{ 'admin.categories.new' | translate }}
                </cdf-button>
              }
            </cdf-empty-state>
          } @else {
            <ol
              class="plain-list cat-list"
              cdkDropList
              [cdkDropListDisabled]="!canEdit() || saving()"
              (cdkDropListDropped)="drop($event)"
              data-testid="category-list"
            >
              @for (c of rows(); track c.id; let i = $index; let last = $last) {
                <li
                  class="cat-row"
                  cdkDrag
                  [attr.data-category-id]="c.id"
                  [class.selected]="form.id === c.id"
                >
                  @if (canEdit()) {
                    <span class="handle" cdkDragHandle aria-hidden="true"
                      ><cdf-icon name="menu" size="sm"
                    /></span>
                  }
                  <span class="muted mono">{{ i + 1 }}</span>
                  <span
                    class="swatch"
                    [style.background]="
                      tokenColor(c.colorToken) ?? 'transparent'
                    "
                    [attr.title]="
                      c.colorToken ?? ('admin.categories.noColor' | translate)
                    "
                    aria-hidden="true"
                  ></span>
                  <span class="cat-name">
                    <strong>{{ c.name }}</strong>
                    <span class="mono muted small">{{ c.slug }}</span>
                  </span>
                  @if (c.iconName) {
                    <cdf-badge variant="neutral" [subtle]="true">{{
                      c.iconName
                    }}</cdf-badge>
                  } @else {
                    <span></span>
                  }
                  <span class="row-actions">
                    <a
                      class="small"
                      [routerLink]="['/translations']"
                      [queryParams]="{ entityType: 'CATEGORY', q: c.slug }"
                      >{{ 'admin.categories.translations' | translate }}</a
                    >
                    @if (canEdit()) {
                      <cdf-icon-button
                        icon="caret-up"
                        size="sm"
                        kind="ghost"
                        [disabled]="i === 0 || saving()"
                        [ariaLabel]="
                          'admin.categories.moveUp'
                            | translate: { name: c.name }
                        "
                        (click)="step(i, -1)"
                      />
                      <cdf-icon-button
                        icon="caret-down"
                        size="sm"
                        kind="ghost"
                        [disabled]="last || saving()"
                        [ariaLabel]="
                          'admin.categories.moveDown'
                            | translate: { name: c.name }
                        "
                        (click)="step(i, 1)"
                      />
                      <cdf-button kind="ghost" size="sm" (click)="startEdit(c)">
                        {{ 'admin.common.edit' | translate }}
                      </cdf-button>
                      <cdf-icon-button
                        icon="trash"
                        size="sm"
                        kind="danger"
                        [ariaLabel]="
                          'admin.categories.deleteAria'
                            | translate: { name: c.name }
                        "
                        (click)="confirmDelete(c)"
                      />
                    }
                  </span>
                </li>
              }
            </ol>
          }
        </section>

        @if (canEdit()) {
          <aside aria-labelledby="cat-form-title">
            <div class="admin-card">
              <h2 id="cat-form-title">
                {{
                  (form.id ? 'admin.categories.edit' : 'admin.categories.new')
                    | translate
                }}
              </h2>
              <cdf-form-field
                [label]="'admin.common.slug' | translate"
                [help]="'admin.categories.slugHelp' | translate"
                controlId="cat-slug"
                [error]="errors()['slug'] ?? null"
              >
                <cdf-input inputId="cat-slug" [(ngModel)]="form.slug" />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.common.name' | translate"
                controlId="cat-name"
                [error]="errors()['name'] ?? null"
              >
                <cdf-input inputId="cat-name" [(ngModel)]="form.name" />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.common.description' | translate"
                controlId="cat-desc"
              >
                <cdf-input inputId="cat-desc" [(ngModel)]="form.description" />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.categories.icon' | translate"
                [help]="'admin.categories.iconHelp' | translate"
                controlId="cat-icon"
              >
                <cdf-input inputId="cat-icon" [(ngModel)]="form.iconName" />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.categories.color' | translate"
                [help]="'admin.categories.colorHelp' | translate"
                controlId="cat-color"
              >
                <span class="color-pick">
                  <span
                    class="swatch swatch--lg"
                    [style.background]="
                      tokenColor(form.colorToken) ?? 'transparent'
                    "
                    aria-hidden="true"
                  ></span>
                  <cdf-select
                    inputId="cat-color"
                    [options]="colorOptions()"
                    [(ngModel)]="form.colorToken"
                  />
                </span>
              </cdf-form-field>
              <div class="form-actions">
                <cdf-button
                  kind="primary"
                  [loading]="saving()"
                  (click)="save()"
                >
                  {{
                    (form.id
                      ? 'admin.common.saveChanges'
                      : 'admin.common.create'
                    ) | translate
                  }}
                </cdf-button>
                @if (form.id) {
                  <cdf-button kind="ghost" (click)="startCreate()">
                    {{ 'admin.common.cancel' | translate }}
                  </cdf-button>
                }
              </div>
              @if (formError(); as e) {
                <p class="form-error" role="alert">{{ e }}</p>
              }
            </div>

            @if (form.id) {
              <div class="admin-card" data-testid="category-plans">
                <h2>{{ 'admin.categories.plansTitle' | translate }}</h2>
                <p class="muted small">
                  {{ 'admin.categories.plansHelp' | translate }}
                </p>
                @if (plansError(); as err) {
                  <cdf-admin-load-error [error]="err" (retry)="loadPlans()" />
                } @else if (plans() === null) {
                  <cdf-skeleton shape="text" />
                } @else {
                  <ul class="plain-list">
                    @for (p of plans(); track p.id) {
                      <li class="plan-row">
                        @if (p.isAllAccess) {
                          <span>{{ p.name }}</span>
                          <cdf-badge variant="info" [subtle]="true">{{
                            'admin.categories.allAccess' | translate
                          }}</cdf-badge>
                        } @else {
                          <cdf-toggle
                            [ngModel]="p.categoryIds.includes(form.id!)"
                            (ngModelChange)="togglePlan(p, $event)"
                            [disabled]="planBusy() === p.id"
                            [label]="p.name"
                          />
                        }
                      </li>
                    } @empty {
                      <li class="muted small">
                        {{ 'admin.categories.noPlans' | translate }}
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </aside>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .cat-row {
        display: grid;
        grid-template-columns: 20px 24px 18px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 8px 4px;
        border-top: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
      }
      .cat-row.selected {
        background: var(--cdf-color-primary-subtle);
      }
      .cat-name {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .handle {
        cursor: grab;
        color: var(--cdf-color-text-subtle);
        display: inline-flex;
      }
      .swatch {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: 1px solid var(--cdf-color-border);
      }
      .swatch--lg {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
      }
      .color-pick {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .color-pick cdf-select {
        flex: 1;
      }
      .plan-row {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 6px 0;
      }
      .cdk-drag-preview {
        box-shadow: var(--cdf-shadow-3);
      }
      @media (max-width: 599.98px) {
        .cat-row {
          grid-template-columns: 20px 18px minmax(0, 1fr);
        }
        .cat-row > .mono,
        .cat-row > cdf-badge {
          display: none;
        }
        .cat-row .row-actions {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class CategoriesPage implements HasUnsavedChanges {
  private readonly client = inject(CategoriesClient);
  private readonly plansClient = inject(PlansClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly tokenColor = tokenColor;
  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.categories),
  );
  protected readonly rows = signal<readonly Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<unknown>(null);
  protected readonly saving = signal(false);
  protected readonly announcement = signal('');
  protected form: FormState = { ...EMPTY_FORM };
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly plans = signal<Plan[] | null>(null);
  protected readonly plansError = signal<unknown>(null);
  protected readonly planBusy = signal<string | null>(null);
  private readonly dirty = new DirtyTracker(() => this.form);

  protected readonly colorOptions = computed<SelectOption<string>[]>(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.categories.noColor') },
      ...CATEGORY_COLOR_TOKENS.map((t) => ({
        value: t,
        label: this.i18n.t(`admin.categories.colors.${t}`),
      })),
    ];
  });

  constructor() {
    void this.refresh();
    this.dirty.mark();
    if (this.canEdit()) void this.loadPlans();
  }

  hasUnsavedChanges(): boolean {
    return this.dirty.isDirty();
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.rows.set((await this.client.list({ take: 200 })).items);
    } catch (err) {
      this.loadError.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadPlans(): Promise<void> {
    this.plansError.set(null);
    try {
      this.plans.set(
        (await this.plansClient.list({ includeInactive: true })).items,
      );
    } catch (err) {
      this.plansError.set(err);
    }
  }

  // ─── Reorder ──────────────────────────────────────────────────────────

  protected drop(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex !== ev.currentIndex)
      void this.persistOrder(
        moveItem(this.rows(), ev.previousIndex, ev.currentIndex),
      );
  }

  protected step(i: number, dir: -1 | 1): void {
    const id = this.rows()[i]?.id;
    void this.persistOrder(moveItem(this.rows(), i, i + dir), id);
  }

  private async persistOrder(
    next: Category[],
    focusId?: string,
  ): Promise<void> {
    const before = this.rows();
    this.rows.set(next.map((c, i) => ({ ...c, sortOrder: i })));
    this.saving.set(true);
    try {
      const res = await this.client.reorder(next.map((c) => c.id));
      this.rows.set(res.items);
      this.announcement.set(this.i18n.t('admin.categories.reordered'));
      if (focusId)
        setTimeout(() =>
          document
            .querySelector<HTMLElement>(
              `[data-category-id="${focusId}"] cdf-button button`,
            )
            ?.focus(),
        );
    } catch (err) {
      this.rows.set(before);
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Form ─────────────────────────────────────────────────────────────

  protected async startCreate(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.form = { ...EMPTY_FORM };
    this.errors.set({});
    this.formError.set(null);
    this.dirty.mark();
  }

  protected async startEdit(row: Category): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.form = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? '',
      iconName: row.iconName ?? '',
      colorToken: row.colorToken ?? '',
    };
    this.errors.set({});
    this.formError.set(null);
    this.dirty.mark();
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty.isDirty()) return true;
    return (
      (await this.confirm.open({
        title: this.i18n.t('admin.unsaved.title'),
        message: this.i18n.t('admin.unsaved.message'),
        confirmLabel: this.i18n.t('admin.unsaved.leave'),
        cancelLabel: this.i18n.t('admin.unsaved.stay'),
        confirmKind: 'danger',
        icon: 'warning',
      })) === true
    );
  }

  protected async save(): Promise<void> {
    const f = this.form;
    const errs: Record<string, string> = {};
    if (!f.slug.trim()) errs['slug'] = this.i18n.t('admin.common.required');
    else if (!CATEGORY_SLUG.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    if (!f.name.trim()) errs['name'] = this.i18n.t('admin.common.required');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;

    this.saving.set(true);
    this.formError.set(null);
    const body = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      iconName: f.iconName.trim() || undefined,
      colorToken: f.colorToken.trim() || undefined,
    };
    try {
      if (f.id) {
        const updated = await this.client.update(f.id, body);
        this.rows.update((rs) =>
          rs.map((r) => (r.id === updated.id ? updated : r)),
        );
        this.toast.success(
          this.i18n.t('admin.categories.updated', { name: updated.name }),
        );
        await this.startEdit(updated);
      } else {
        const created = await this.client.create(body);
        this.rows.update((rs) => [...rs, created]);
        this.toast.success(
          this.i18n.t('admin.categories.created', { name: created.name }),
        );
        this.dirty.mark();
        await this.startEdit(created);
      }
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** Plan ↔ category assignment from the category side (docs/04). */
  protected async togglePlan(p: Plan, on: boolean): Promise<void> {
    const id = this.form.id;
    if (!id) return;
    const categoryIds = on
      ? [...new Set([...p.categoryIds, id])]
      : p.categoryIds.filter((c) => c !== id);
    this.planBusy.set(p.id);
    try {
      const updated = await this.plansClient.update(p.id, { categoryIds });
      this.plans.update((ps) =>
        (ps ?? []).map((x) => (x.id === updated.id ? updated : x)),
      );
      this.toast.success(
        this.i18n.t(
          on ? 'admin.categories.planAdded' : 'admin.categories.planRemoved',
          { plan: p.name },
        ),
      );
    } catch (err) {
      this.plans.update((ps) => (ps ? [...ps] : ps)); // re-render the toggle
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.planBusy.set(null);
    }
  }

  protected async confirmDelete(row: Category): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: row.name }),
      message: this.i18n.t('admin.categories.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      if (this.form.id === row.id) {
        this.dirty.clear();
        await this.startCreate();
      }
      this.toast.success(
        this.i18n.t('admin.categories.deleted', { name: row.name }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}
