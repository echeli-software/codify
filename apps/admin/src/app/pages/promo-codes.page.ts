import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  Input,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  PromoCodesClient,
  type CreatePromoCodeBody,
  type PromoCode,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { isoToLocal, localToIso } from '../core/catalog';
import { LoadError } from '../shared/load-error';
import type { HasUnsavedChanges } from '../core/unsaved-changes';

const CODE = /^[A-Za-z0-9_-]{3,32}$/;
/** docs/07 §12: grants above 1000 coins are admin-only; codes stay ≤ 10 000. */
export const MAX_PROMO_COINS = 10_000;

export interface PromoCodeDraft {
  code: string;
  coins: number | string;
  maxRedemptions: number | string | null;
  /** `datetime-local` values. */
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  description: string;
}

/** Client-side checks mirroring the API DTO; values are `admin.*` keys. */
export function validatePromoCode(
  d: PromoCodeDraft,
  isNew: boolean,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (isNew && !CODE.test(d.code.trim()))
    errs['code'] = 'admin.promoCodes.invalidCode';
  const coins = Number(d.coins);
  if (!Number.isInteger(coins) || coins < 1 || coins > MAX_PROMO_COINS)
    errs['coins'] = 'admin.promoCodes.invalidCoins';
  if (d.maxRedemptions !== null && `${d.maxRedemptions}`.trim() !== '') {
    const m = Number(d.maxRedemptions);
    if (!Number.isInteger(m) || m < 1)
      errs['maxRedemptions'] = 'admin.common.invalidNumber';
  }
  const s = localToIso(d.startsAt);
  const e = localToIso(d.endsAt);
  if (s && e && e <= s) errs['endsAt'] = 'admin.promoCodes.invalidWindow';
  return errs;
}

/** Draft → API body (code upper-cased; empty limit = unlimited). */
export function promoCodeBody(d: PromoCodeDraft): CreatePromoCodeBody {
  const max =
    d.maxRedemptions === null || `${d.maxRedemptions}`.trim() === ''
      ? null
      : Number(d.maxRedemptions);
  return {
    code: d.code.trim().toUpperCase(),
    coins: Number(d.coins),
    maxRedemptions: max,
    startsAt: localToIso(d.startsAt),
    endsAt: localToIso(d.endsAt),
    isActive: d.isActive,
    description: d.description.trim() || null,
  };
}

function emptyDraft(): PromoCodeDraft {
  return {
    code: '',
    coins: 50,
    maxRedemptions: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
    description: '',
  };
}

/**
 * Gamification → Promo codes (docs/08 §12): coin codes students redeem once
 * each (case-insensitive) inside an optional window and redemption limit.
 * ADMIN only; every change is audited server-side (`promo_code.*`). A code
 * that was redeemed can't be deleted — it is deactivated instead.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    EmptyState,
    FormField,
    Icon,
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
          <h1>{{ 'admin.promoCodes.title' | translate }}</h1>
          <p class="muted">{{ 'admin.promoCodes.subtitle' | translate }}</p>
        </div>
        <div class="page-head__actions">
          <cdf-button kind="primary" (click)="startNew()">
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.promoCodes.new' | translate }}
          </cdf-button>
        </div>
      </header>

      @if (editing(); as mode) {
        <form
          class="admin-card"
          (submit)="save($event)"
          aria-labelledby="pc-form-title"
          data-testid="promo-code-form"
        >
          <h2 id="pc-form-title">
            {{
              (mode === 'new'
                ? 'admin.promoCodes.new'
                : 'admin.promoCodes.editTitle'
              ) | translate: { code: draft.code }
            }}
          </h2>
          <div class="form-grid">
            <cdf-form-field
              [label]="'admin.promoCodes.code' | translate"
              controlId="pc-code"
              [error]="fieldError('code')"
              [help]="
                mode === 'new'
                  ? ('admin.promoCodes.codeHelp' | translate)
                  : ('admin.promoCodes.codeFixed' | translate)
              "
            >
              <cdf-input
                inputId="pc-code"
                name="code"
                [disabled]="mode !== 'new'"
                [(ngModel)]="draft.code"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promoCodes.coins' | translate"
              controlId="pc-coins"
              [error]="fieldError('coins')"
            >
              <cdf-input
                inputId="pc-coins"
                name="coins"
                type="number"
                [(ngModel)]="draft.coins"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promoCodes.maxRedemptions' | translate"
              controlId="pc-max"
              [error]="fieldError('maxRedemptions')"
              [help]="'admin.promoCodes.maxHelp' | translate"
            >
              <cdf-input
                inputId="pc-max"
                name="maxRedemptions"
                type="number"
                [(ngModel)]="draft.maxRedemptions"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promoCodes.startsAt' | translate"
              controlId="pc-starts"
            >
              <input
                id="pc-starts"
                name="startsAt"
                class="form-control"
                type="datetime-local"
                [(ngModel)]="draft.startsAt"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promoCodes.endsAt' | translate"
              controlId="pc-ends"
              [error]="fieldError('endsAt')"
            >
              <input
                id="pc-ends"
                name="endsAt"
                class="form-control"
                type="datetime-local"
                [(ngModel)]="draft.endsAt"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promoCodes.description' | translate"
              controlId="pc-desc"
            >
              <cdf-input
                inputId="pc-desc"
                name="description"
                [(ngModel)]="draft.description"
              />
            </cdf-form-field>
          </div>
          <label class="check">
            <input
              type="checkbox"
              name="isActive"
              [(ngModel)]="draft.isActive"
            />
            {{ 'admin.promoCodes.active' | translate }}
          </label>
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
          icon="coins"
          [title]="'admin.promoCodes.emptyTitle' | translate"
          [description]="'admin.promoCodes.emptyDescription' | translate"
        >
          <cdf-button kind="primary" (click)="startNew()">{{
            'admin.promoCodes.new' | translate
          }}</cdf-button>
        </cdf-empty-state>
      } @else {
        <div class="admin-card table-scroll">
          <table class="admin-table" data-testid="promo-codes">
            <thead>
              <tr>
                <th scope="col">{{ 'admin.promoCodes.code' | translate }}</th>
                <th scope="col" class="num">
                  {{ 'admin.promoCodes.coins' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.promoCodes.redemptions' | translate }}
                </th>
                <th scope="col">{{ 'admin.promoCodes.window' | translate }}</th>
                <th scope="col">{{ 'admin.promoCodes.status' | translate }}</th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.common.actions' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (p of rows(); track p.id) {
                <tr>
                  <td>
                    <span class="mono">{{ p.code }}</span>
                    @if (p.description) {
                      <div class="small muted">{{ p.description }}</div>
                    }
                  </td>
                  <td class="num">{{ p.coins | locale: 'integer' }}</td>
                  <td class="num">
                    {{ p.redemptions | locale: 'integer' }}
                    @if (p.maxRedemptions !== null) {
                      / {{ p.maxRedemptions | locale: 'integer' }}
                    }
                  </td>
                  <td class="small">
                    @if (p.startsAt || p.endsAt) {
                      {{ (p.startsAt | locale: 'datetime') || '…' }} –
                      {{ (p.endsAt | locale: 'datetime') || '…' }}
                    } @else {
                      {{ 'admin.promoCodes.always' | translate }}
                    }
                  </td>
                  <td>
                    <cdf-badge
                      [variant]="p.redeemableNow ? 'success' : 'neutral'"
                      [subtle]="true"
                      >{{
                        (p.redeemableNow
                          ? 'admin.promoCodes.redeemable'
                          : p.isActive
                            ? 'admin.promoCodes.notRedeemable'
                            : 'admin.promoCodes.inactive'
                        ) | translate
                      }}</cdf-badge
                    >
                  </td>
                  <td>
                    <div class="row-actions">
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        (click)="startEdit(p)"
                        >{{ 'admin.common.edit' | translate }}</cdf-button
                      >
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        (click)="remove(p)"
                        [attr.aria-label]="
                          'admin.promoCodes.deleteAria'
                            | translate: { code: p.code }
                        "
                        >{{
                          (p.redemptions > 0
                            ? 'admin.promoCodes.deactivate'
                            : 'admin.common.delete'
                          ) | translate
                        }}</cdf-button
                      >
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
  styles: [
    `
      .check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: var(--cdf-space-2, 8px) 0;
      }
    `,
  ],
})
export class PromoCodesPage implements HasUnsavedChanges {
  private readonly client = inject(PromoCodesClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly rows = signal<PromoCode[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<'new' | 'edit' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected draft: PromoCodeDraft = emptyDraft();
  private editId: string | null = null;
  /** Draft snapshot when the form opened (unsaved-changes guard). */
  private snapshot = '';

  hasUnsavedChanges(): boolean {
    return (
      this.editing() !== null && JSON.stringify(this.draft) !== this.snapshot
    );
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
      this.rows.set(await this.client.list());
    } catch (err) {
      this.rows.set(null);
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected startNew(): void {
    this.draft = emptyDraft();
    this.editId = null;
    this.fieldErrors.set({});
    this.formError.set(null);
    this.snapshot = JSON.stringify(this.draft);
    this.editing.set('new');
  }

  protected startEdit(p: PromoCode): void {
    this.draft = {
      code: p.code,
      coins: p.coins,
      maxRedemptions: p.maxRedemptions,
      startsAt: isoToLocal(p.startsAt),
      endsAt: isoToLocal(p.endsAt),
      isActive: p.isActive,
      description: p.description ?? '',
    };
    this.editId = p.id;
    this.fieldErrors.set({});
    this.formError.set(null);
    this.snapshot = JSON.stringify(this.draft);
    this.editing.set('edit');
  }

  protected async save(ev: Event): Promise<void> {
    ev.preventDefault();
    const isNew = this.editing() === 'new';
    const errs = validatePromoCode(this.draft, isNew);
    this.fieldErrors.set(errs);
    if (Object.keys(errs).length) return;
    this.saving.set(true);
    this.formError.set(null);
    const body = promoCodeBody(this.draft);
    try {
      const saved =
        isNew || !this.editId
          ? await this.client.create(body)
          : await this.client.update(this.editId, {
              coins: body.coins,
              maxRedemptions: body.maxRedemptions,
              startsAt: body.startsAt,
              endsAt: body.endsAt,
              isActive: body.isActive,
              description: body.description,
            });
      this.rows.update((rows) => [
        saved,
        ...(rows ?? []).filter((r) => r.id !== saved.id),
      ]);
      this.editing.set(null);
      this.toast.success(
        this.i18n.t('admin.promoCodes.saved', { code: saved.code }),
      );
    } catch (err) {
      this.formError.set(this.errors.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(p: PromoCode): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: p.code }),
      message: this.i18n.t(
        p.redemptions > 0
          ? 'admin.promoCodes.deactivateMessage'
          : 'admin.promoCodes.deleteMessage',
      ),
      confirmLabel: this.i18n.t(
        p.redemptions > 0
          ? 'admin.promoCodes.deactivate'
          : 'admin.common.delete',
      ),
      confirmKind: 'danger',
    });
    if (!ok) return;
    try {
      const res = await this.client.remove(p.id);
      if (res.deleted) {
        this.rows.update((rows) => (rows ?? []).filter((r) => r.id !== p.id));
      } else {
        this.rows.update((rows) =>
          (rows ?? []).map((r) =>
            r.id === p.id ? { ...r, isActive: false, redeemableNow: false } : r,
          ),
        );
      }
      this.toast.success(
        this.i18n.t(
          res.deleted
            ? 'admin.promoCodes.deleted'
            : 'admin.promoCodes.deactivated',
          { code: p.code },
        ),
      );
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    }
  }
}
