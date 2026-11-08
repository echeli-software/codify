import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Button,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import { AdminOpsClient, type ItemCategoryAdmin } from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';
import { DirtyTracker } from '../core/dirty';
import type { HasUnsavedChanges } from '../core/unsaved-changes';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export interface CategoryDraft {
  slug: string;
  name: string;
  sortOrder: number | string;
}

/** Client-side checks mirroring the API DTO; keys are `admin.*` messages. */
export function validateCategory(
  d: CategoryDraft,
  isNew: boolean,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (isNew && !SLUG.test(d.slug.trim()))
    errs['slug'] = 'admin.common.invalidSlug';
  if (!d.name.trim()) errs['name'] = 'admin.common.required';
  const n = Number(d.sortOrder);
  if (!Number.isInteger(n) || n < 0 || n > 10000)
    errs['sortOrder'] = 'admin.common.invalidNumber';
  return errs;
}

/**
 * Shop → Item Categories (docs/04): slug, name, sort order. Slugs are
 * immutable (items reference them); categories still used by items can't
 * be deleted. Names are single-locale: ItemCategory is not yet a
 * translatable entity.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    LoadError,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.itemCategories.title' | translate }}</h1>
          <p class="muted">{{ 'admin.itemCategories.subtitle' | translate }}</p>
        </div>
        <div class="page-head__actions">
          <cdf-button kind="primary" (click)="startNew()">
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.itemCategories.new' | translate }}
          </cdf-button>
        </div>
      </header>

      @if (editing(); as mode) {
        <form
          class="admin-card"
          (submit)="save($event)"
          aria-labelledby="cat-form-title"
        >
          <h2 id="cat-form-title">
            {{
              (mode === 'new'
                ? 'admin.itemCategories.new'
                : 'admin.itemCategories.editTitle'
              ) | translate: { slug: draft.slug }
            }}
          </h2>
          <div class="form-grid">
            <cdf-form-field
              [label]="'admin.common.slug' | translate"
              controlId="cat-slug"
              [error]="fieldError('slug')"
              [help]="
                mode === 'new'
                  ? null
                  : ('admin.itemCategories.slugFixed' | translate)
              "
            >
              <cdf-input
                inputId="cat-slug"
                name="slug"
                [disabled]="mode !== 'new'"
                [(ngModel)]="draft.slug"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.common.name' | translate"
              controlId="cat-name"
              [error]="fieldError('name')"
            >
              <cdf-input
                inputId="cat-name"
                name="name"
                [(ngModel)]="draft.name"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.itemCategories.sortOrder' | translate"
              controlId="cat-sort"
              [error]="fieldError('sortOrder')"
            >
              <cdf-input
                inputId="cat-sort"
                name="sortOrder"
                type="number"
                [(ngModel)]="draft.sortOrder"
              />
            </cdf-form-field>
          </div>
          <div class="form-actions">
            <cdf-button kind="primary" type="submit" [loading]="saving()">{{
              'admin.common.save' | translate
            }}</cdf-button>
            <cdf-button kind="ghost" (click)="editing.set(null)">{{
              'admin.common.cancel' | translate
            }}</cdf-button>
          </div>
          @if (formError(); as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </form>
      }

      @if (error(); as e) {
        <cdf-load-error [message]="e" (retry)="load()" />
      } @else if (rows() === null) {
        <cdf-skeleton shape="rect" height="200px" />
      } @else if (rows()!.length === 0) {
        <cdf-empty-state
          icon="folder-open"
          [title]="'admin.itemCategories.emptyTitle' | translate"
          [description]="'admin.itemCategories.emptyDescription' | translate"
        >
          <cdf-button kind="primary" (click)="startNew()">{{
            'admin.itemCategories.new' | translate
          }}</cdf-button>
        </cdf-empty-state>
      } @else {
        <div class="admin-card table-scroll">
          <table class="admin-table" data-testid="item-categories">
            <thead>
              <tr>
                <th scope="col">{{ 'admin.common.slug' | translate }}</th>
                <th scope="col">{{ 'admin.common.name' | translate }}</th>
                <th scope="col" class="num">
                  {{ 'admin.itemCategories.sortOrder' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.itemCategories.items' | translate }}
                </th>
                <th scope="col">{{ 'admin.common.updatedAt' | translate }}</th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.common.actions' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (c of rows(); track c.slug) {
                <tr>
                  <td class="mono">{{ c.slug }}</td>
                  <td>{{ c.name }}</td>
                  <td class="num">{{ c.sortOrder }}</td>
                  <td class="num">{{ c.itemCount | locale: 'integer' }}</td>
                  <td class="small">{{ c.updatedAt | locale: 'date' }}</td>
                  <td>
                    <div class="row-actions">
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        (click)="startEdit(c)"
                        >{{ 'admin.common.edit' | translate }}</cdf-button
                      >
                      <cdf-icon-button
                        icon="trash"
                        size="sm"
                        kind="danger"
                        [disabled]="c.itemCount > 0"
                        [ariaLabel]="
                          (c.itemCount > 0
                            ? 'admin.itemCategories.inUse'
                            : 'admin.itemCategories.deleteAria'
                          ) | translate: { name: c.name, count: c.itemCount }
                        "
                        (click)="remove(c)"
                      />
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class ItemCategoriesPage implements HasUnsavedChanges {
  private readonly client = inject(AdminOpsClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly rows = signal<ItemCategoryAdmin[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<'new' | 'edit' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected draft: CategoryDraft = { slug: '', name: '', sortOrder: 0 };
  private readonly dirty = new DirtyTracker(() => this.draft);

  /** docs/04 §5: an open form with edits blocks navigation. */
  hasUnsavedChanges(): boolean {
    return this.editing() !== null && this.dirty.isDirty();
  }

  constructor() {
    void this.load();
  }

  protected fieldError(key: string): string | null {
    const k = this.fieldErrors()[key];
    return k ? this.i18n.t(k) : null;
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.rows.set(await this.client.itemCategories());
    } catch (err) {
      this.rows.set(null);
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected startNew(): void {
    const max = Math.max(0, ...(this.rows() ?? []).map((r) => r.sortOrder));
    this.draft = { slug: '', name: '', sortOrder: max + 10 };
    this.fieldErrors.set({});
    this.formError.set(null);
    this.dirty.mark();
    this.editing.set('new');
  }

  protected startEdit(c: ItemCategoryAdmin): void {
    this.draft = { slug: c.slug, name: c.name, sortOrder: c.sortOrder };
    this.fieldErrors.set({});
    this.formError.set(null);
    this.dirty.mark();
    this.editing.set('edit');
  }

  protected async save(ev: Event): Promise<void> {
    ev.preventDefault();
    const isNew = this.editing() === 'new';
    const errs = validateCategory(this.draft, isNew);
    this.fieldErrors.set(errs);
    if (Object.keys(errs).length) return;
    this.saving.set(true);
    this.formError.set(null);
    const body = {
      name: this.draft.name.trim(),
      sortOrder: Number(this.draft.sortOrder),
    };
    try {
      const saved = isNew
        ? await this.client.createItemCategory({
            slug: this.draft.slug.trim(),
            ...body,
          })
        : await this.client.updateItemCategory(this.draft.slug, body);
      this.rows.update((rows) =>
        [...(rows ?? []).filter((r) => r.slug !== saved.slug), saved].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug),
        ),
      );
      this.editing.set(null);
      this.toast.success(
        this.i18n.t('admin.itemCategories.saved', { name: saved.name }),
      );
    } catch (err) {
      this.formError.set(this.errors.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(c: ItemCategoryAdmin): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: c.name }),
      message: this.i18n.t('admin.itemCategories.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
    });
    if (!ok) return;
    const before = this.rows();
    // Optimistic removal with rollback (docs/04 §5).
    this.rows.update((rows) => (rows ?? []).filter((r) => r.slug !== c.slug));
    try {
      await this.client.deleteItemCategory(c.slug);
      this.toast.success(
        this.i18n.t('admin.itemCategories.deleted', { name: c.name }),
      );
    } catch (err) {
      this.rows.set(before);
      this.errors.toast(err, 'admin.errors.actionFailed');
    }
  }
}
