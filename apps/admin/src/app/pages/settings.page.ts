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
  IconButton,
  Input,
  Select,
  Skeleton,
  Textarea,
  ToastService,
  Toggle,
  type SelectOption,
} from '@codify/ui-bootstrap';
import {
  BillingClient,
  FlagsClient,
  type CreateFeatureFlagBody,
  type FeatureFlag,
  type FeatureFlagValue,
  type StripeStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';

const KEY_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

/** Known flag surfaces (free text is accepted by the API too). */
const SURFACE_LABELS: Record<string, string> = {
  student: 'admin.settings.flags.surfaceStudent',
  public: 'admin.settings.flags.surfacePublic',
  admin: 'admin.settings.flags.surfaceAdmin',
};
const VARIANT_RE = /^[a-z0-9_-]{1,40}$/i;
const SURFACE_RE = /^[a-z0-9_-]{1,40}$/;

export interface VariantDraft {
  key: string;
  weight: number | string;
}

/** Form model for one flag (numbers arrive as strings from inputs). */
export interface FlagDraft {
  key: string;
  description: string;
  enabled: boolean;
  isActive: boolean;
  rolloutPct: number | string;
  holdoutPct: number | string;
  surface: string;
  variants: VariantDraft[];
}

export function emptyDraft(): FlagDraft {
  return {
    key: '',
    description: '',
    enabled: true,
    isActive: true,
    rolloutPct: 100,
    holdoutPct: 0,
    surface: 'student',
    variants: [],
  };
}

export function draftFrom(flag: FeatureFlag): FlagDraft {
  return {
    key: flag.key,
    description: flag.description ?? '',
    enabled: flag.value.enabled,
    isActive: flag.isActive,
    rolloutPct: flag.value.rolloutPct ?? 100,
    holdoutPct: flag.value.holdoutPct ?? 0,
    surface: flag.value.surface ?? '',
    variants: Object.entries(flag.value.variants ?? {}).map(
      ([key, weight]) => ({
        key,
        weight,
      }),
    ),
  };
}

/**
 * Client-side checks mirroring the API's parseFlagValue (field → `admin.*`
 * message key). Variant rows are keyed `variant<i>`.
 */
export function validateFlag(
  d: FlagDraft,
  isNew: boolean,
): Record<string, string> {
  const errs: Record<string, string> = {};
  const key = d.key.trim();
  if (isNew && (!KEY_RE.test(key) || key.length > 80))
    errs['key'] = 'admin.settings.flags.invalidKey';
  for (const f of ['rolloutPct', 'holdoutPct'] as const) {
    const n = Number(d[f]);
    if (d[f] === '' || !Number.isFinite(n) || n < 0 || n > 100)
      errs[f] = 'admin.settings.flags.invalidPct';
  }
  if (d.surface.trim() && !SURFACE_RE.test(d.surface.trim()))
    errs['surface'] = 'admin.settings.flags.invalidSurface';
  const seen = new Set<string>();
  d.variants.forEach((v, i) => {
    const k = v.key.trim();
    const w = Number(v.weight);
    if (!VARIANT_RE.test(k) || k === 'holdout' || seen.has(k))
      errs[`variant${i}`] = 'admin.settings.flags.invalidVariant';
    else if (v.weight === '' || !Number.isInteger(w) || w < 0 || w > 10000)
      errs[`variant${i}`] = 'admin.settings.flags.invalidWeight';
    seen.add(k);
  });
  return errs;
}

/** Draft → API `value` (defaults omitted so stored JSON stays minimal). */
export function valueFrom(d: FlagDraft): FeatureFlagValue {
  const value: FeatureFlagValue = { enabled: d.enabled };
  const rollout = Number(d.rolloutPct);
  const holdout = Number(d.holdoutPct);
  if (rollout !== 100) value.rolloutPct = rollout;
  if (holdout !== 0) value.holdoutPct = holdout;
  if (d.variants.length) {
    value.variants = Object.fromEntries(
      d.variants.map((v) => [v.key.trim(), Number(v.weight)]),
    );
  }
  if (d.surface.trim()) value.surface = d.surface.trim();
  return value;
}

/** "control 50% · treatment 50%" (weights normalised to shares). */
export function variantSummary(
  variants: Record<string, number> | undefined,
): string {
  const entries = Object.entries(variants ?? {});
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!entries.length || total <= 0) return '';
  return entries
    .map(([k, w]) => `${k} ${Math.round((w / total) * 100)}%`)
    .join(' · ');
}

/**
 * Settings (docs/04 §Settings, ADMIN): feature flags + experiments
 * (docs/10 §9) with rollout / holdout / weighted variants, and a read-only
 * Stripe connection status (booleans and webhook paths — never secrets).
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
    IconButton,
    Input,
    LoadError,
    Select,
    Skeleton,
    Textarea,
    Toggle,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page" data-testid="settings-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.settings.title' | translate }}</h1>
          <p class="muted">{{ 'admin.settings.subtitle' | translate }}</p>
        </div>
      </header>

      <section class="admin-card" aria-labelledby="stripe-title">
        <h2 id="stripe-title">
          <cdf-icon name="credit-card" size="sm" />
          {{ 'admin.settings.stripe.title' | translate }}
        </h2>
        @if (stripeError(); as e) {
          <cdf-load-error [message]="e" (retry)="loadStripe()" />
        } @else if (stripe(); as s) {
          <dl class="kv" data-testid="stripe-status">
            <dt>{{ 'admin.settings.stripe.mode' | translate }}</dt>
            <dd>
              <cdf-badge
                [variant]="s.mode === 'stripe' ? 'success' : 'warning'"
                >{{
                  (s.mode === 'stripe'
                    ? 'admin.settings.stripe.modeStripe'
                    : 'admin.settings.stripe.modeDev'
                  ) | translate
                }}</cdf-badge
              >
            </dd>
            <dt>{{ 'admin.settings.stripe.secretKey' | translate }}</dt>
            <dd>
              <cdf-badge
                [variant]="s.secretKeyConfigured ? 'success' : 'danger'"
                >{{ configured(s.secretKeyConfigured) | translate }}</cdf-badge
              >
            </dd>
            <dt>{{ 'admin.settings.stripe.webhookSecret' | translate }}</dt>
            <dd>
              <cdf-badge
                [variant]="s.webhookSecretConfigured ? 'success' : 'danger'"
                >{{
                  configured(s.webhookSecretConfigured) | translate
                }}</cdf-badge
              >
            </dd>
            <dt>{{ 'admin.settings.stripe.webhookUrl' | translate }}</dt>
            <dd class="mono">{{ s.webhookUrl ?? s.webhookPath }}</dd>
            <dt>{{ 'admin.settings.stripe.revenueCat' | translate }}</dt>
            <dd>
              <cdf-badge
                [variant]="s.revenueCatWebhookConfigured ? 'success' : 'danger'"
                >{{
                  configured(s.revenueCatWebhookConfigured) | translate
                }}</cdf-badge
              >
              <span class="mono small">{{ s.revenueCatWebhookPath }}</span>
            </dd>
          </dl>
          <p class="muted small">
            {{ 'admin.settings.stripe.rotationHint' | translate }}
          </p>
        } @else {
          <cdf-skeleton shape="rect" height="120px" />
        }
      </section>

      <section aria-labelledby="flags-title">
        <div class="section-head">
          <div>
            <h2 id="flags-title">
              {{ 'admin.settings.flags.title' | translate }}
            </h2>
            <p class="muted small">
              {{ 'admin.settings.flags.subtitle' | translate }}
            </p>
          </div>
          <cdf-button
            kind="primary"
            (click)="startNew()"
            data-testid="flag-new"
          >
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.settings.flags.new' | translate }}
          </cdf-button>
        </div>

        @if (editing(); as mode) {
          <form
            class="admin-card"
            (submit)="save($event)"
            aria-labelledby="flag-form-title"
            data-testid="flag-form"
          >
            <h3 id="flag-form-title">
              {{
                (mode === 'new'
                  ? 'admin.settings.flags.new'
                  : 'admin.settings.flags.editTitle'
                ) | translate: { key: draft.key }
              }}
            </h3>
            <div class="form-grid">
              <cdf-form-field
                [label]="'admin.settings.flags.key' | translate"
                controlId="flag-key"
                [error]="fieldError('key')"
                [help]="
                  (mode === 'new'
                    ? 'admin.settings.flags.keyHelp'
                    : 'admin.settings.flags.keyFixed'
                  ) | translate
                "
              >
                <cdf-input
                  inputId="flag-key"
                  name="key"
                  [disabled]="mode !== 'new'"
                  [(ngModel)]="draft.key"
                />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.settings.flags.surface' | translate"
                controlId="flag-surface"
                [error]="fieldError('surface')"
                [help]="'admin.settings.flags.surfaceHelp' | translate"
              >
                <cdf-select
                  inputId="flag-surface"
                  name="surface"
                  [options]="surfaceOptions()"
                  [(ngModel)]="draft.surface"
                />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.settings.flags.rolloutPct' | translate"
                controlId="flag-rollout"
                [error]="fieldError('rolloutPct')"
                [help]="'admin.settings.flags.rolloutHelp' | translate"
              >
                <cdf-input
                  inputId="flag-rollout"
                  name="rolloutPct"
                  type="number"
                  [(ngModel)]="draft.rolloutPct"
                />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.settings.flags.holdoutPct' | translate"
                controlId="flag-holdout"
                [error]="fieldError('holdoutPct')"
                [help]="'admin.settings.flags.holdoutHelp' | translate"
              >
                <cdf-input
                  inputId="flag-holdout"
                  name="holdoutPct"
                  type="number"
                  [(ngModel)]="draft.holdoutPct"
                />
              </cdf-form-field>
            </div>
            <cdf-form-field [label]="'admin.common.description' | translate">
              <cdf-textarea
                name="description"
                [rows]="2"
                [maxLength]="500"
                [(ngModel)]="draft.description"
              />
            </cdf-form-field>
            <div class="toggles">
              <cdf-toggle
                name="enabled"
                [label]="'admin.settings.flags.enabled' | translate"
                [(ngModel)]="draft.enabled"
                data-testid="flag-enabled"
              />
              <cdf-toggle
                name="isActive"
                [label]="'admin.settings.flags.isActive' | translate"
                [(ngModel)]="draft.isActive"
              />
            </div>

            <fieldset class="variants">
              <legend>{{ 'admin.settings.flags.variants' | translate }}</legend>
              <p class="muted small">
                {{ 'admin.settings.flags.variantsHelp' | translate }}
              </p>
              @for (v of draft.variants; track $index; let i = $index) {
                <div class="variant-row" data-testid="variant-row">
                  <cdf-input
                    [name]="'variantKey' + i"
                    [ariaLabel]="
                      'admin.settings.flags.variantKey'
                        | translate: { n: i + 1 }
                    "
                    [placeholder]="
                      'admin.settings.flags.variantKeyPlaceholder' | translate
                    "
                    [(ngModel)]="v.key"
                  />
                  <cdf-input
                    [name]="'variantWeight' + i"
                    type="number"
                    [ariaLabel]="
                      'admin.settings.flags.variantWeight'
                        | translate: { n: i + 1 }
                    "
                    [(ngModel)]="v.weight"
                  />
                  <cdf-icon-button
                    icon="trash"
                    size="sm"
                    kind="danger"
                    [ariaLabel]="
                      'admin.settings.flags.removeVariant'
                        | translate: { n: i + 1 }
                    "
                    (click)="removeVariant(i)"
                  />
                  @if (fieldError('variant' + i); as e) {
                    <p class="form-error variant-error" role="alert">{{ e }}</p>
                  }
                </div>
              }
              <cdf-button
                kind="secondary"
                size="sm"
                (click)="addVariant()"
                data-testid="variant-add"
              >
                <cdf-icon name="plus" size="sm" />
                {{ 'admin.settings.flags.addVariant' | translate }}
              </cdf-button>
            </fieldset>

            <div class="form-actions">
              <cdf-button
                kind="primary"
                type="submit"
                [loading]="saving()"
                data-testid="flag-save"
                >{{ 'admin.common.save' | translate }}</cdf-button
              >
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
        } @else if (flags() === null) {
          <cdf-skeleton shape="rect" height="200px" />
        } @else if (flags()!.length === 0) {
          <cdf-empty-state
            icon="gear"
            [title]="'admin.settings.flags.emptyTitle' | translate"
            [description]="'admin.settings.flags.emptyDescription' | translate"
          />
        } @else {
          <div class="admin-card table-scroll">
            <table class="admin-table" data-testid="flags-table">
              <thead>
                <tr>
                  <th scope="col">
                    {{ 'admin.settings.flags.key' | translate }}
                  </th>
                  <th scope="col">{{ 'admin.common.status' | translate }}</th>
                  <th scope="col" class="num">
                    {{ 'admin.settings.flags.rolloutShort' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.settings.flags.holdoutShort' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.settings.flags.variants' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.settings.flags.surface' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.common.updatedAt' | translate }}
                  </th>
                  <th scope="col">
                    <span class="visually-hidden">{{
                      'admin.common.actions' | translate
                    }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (f of flags(); track f.key) {
                  <tr [attr.data-flag]="f.key">
                    <td>
                      <span class="mono">{{ f.key }}</span>
                      @if (f.description) {
                        <div class="muted small">{{ f.description }}</div>
                      }
                    </td>
                    <td>
                      <cdf-badge [variant]="statusVariant(f)">{{
                        statusKey(f) | translate
                      }}</cdf-badge>
                      @if (f.builtIn) {
                        <cdf-badge variant="neutral" [subtle]="true">{{
                          'admin.settings.flags.builtIn' | translate
                        }}</cdf-badge>
                      }
                    </td>
                    <td class="num">
                      {{
                        (f.value.rolloutPct ?? 100) / 100 | locale: 'percent'
                      }}
                    </td>
                    <td class="num">
                      {{ (f.value.holdoutPct ?? 0) / 100 | locale: 'percent' }}
                    </td>
                    <td class="small">{{ summary(f) }}</td>
                    <td class="small">{{ f.value.surface ?? '' }}</td>
                    <td class="small">{{ f.updatedAt | locale: 'date' }}</td>
                    <td>
                      <div class="row-actions">
                        <cdf-button
                          kind="ghost"
                          size="sm"
                          (click)="startEdit(f)"
                          [attr.data-testid]="'flag-edit-' + f.key"
                          >{{ 'admin.common.edit' | translate }}</cdf-button
                        >
                        <cdf-icon-button
                          icon="trash"
                          size="sm"
                          kind="danger"
                          [disabled]="f.builtIn"
                          [ariaLabel]="
                            (f.builtIn
                              ? 'admin.settings.flags.builtInDelete'
                              : 'admin.settings.flags.deleteAria'
                            ) | translate: { key: f.key }
                          "
                          (click)="remove(f)"
                        />
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      /* Let wide tables scroll inside .table-scroll instead of widening the page. */
      :host {
        display: block;
        min-width: 0;
      }
      /* Contain absolutely positioned cells (visually-hidden labels). */
      .table-scroll {
        position: relative;
      }
      section {
        margin-bottom: var(--cdf-space-4);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-1);
        font-size: 1.125rem;
        margin: 0 0 var(--cdf-space-2);
      }
      h3 {
        font-size: 1rem;
        margin: 0 0 var(--cdf-space-3);
      }
      .section-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--cdf-space-2) var(--cdf-space-3);
        margin: 0 0 var(--cdf-space-2);
        align-items: center;
      }
      .kv dt {
        font-weight: 600;
      }
      .kv dd {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        align-items: center;
        overflow-wrap: anywhere;
      }
      .toggles {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-4);
        margin: var(--cdf-space-2) 0 var(--cdf-space-3);
      }
      .variants {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-3);
        margin: 0 0 var(--cdf-space-3);
      }
      .variants legend {
        font-size: 0.875rem;
        font-weight: 600;
        float: none;
        width: auto;
        padding: 0 var(--cdf-space-1);
        margin: 0;
      }
      .variant-row {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
        gap: var(--cdf-space-2);
        align-items: center;
        margin-bottom: var(--cdf-space-2);
      }
      .variant-error {
        grid-column: 1 / -1;
        margin: 0;
      }
      td cdf-badge + cdf-badge {
        margin-inline-start: var(--cdf-space-1);
      }
      @media (max-width: 575px) {
        .kv {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class SettingsPage {
  private readonly flagsClient = inject(FlagsClient);
  private readonly billing = inject(BillingClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly flags = signal<FeatureFlag[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly stripe = signal<StripeStatus | null>(null);
  protected readonly stripeError = signal<string | null>(null);
  protected readonly editing = signal<'new' | 'edit' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected draft: FlagDraft = emptyDraft();

  constructor() {
    void this.load();
    void this.loadStripe();
  }

  protected surfaceOptions(): SelectOption[] {
    const opts: SelectOption[] = Object.entries(SURFACE_LABELS).map(
      ([value, key]) => ({ value, label: this.i18n.t(key) }),
    );
    opts.unshift({ value: '', label: this.i18n.t('admin.common.none') });
    // Keep a custom surface set through the API selectable.
    const current = this.draft.surface;
    if (current && !opts.some((o) => o.value === current))
      opts.push({ value: current, label: current });
    return opts;
  }

  protected configured(on: boolean): string {
    return on
      ? 'admin.settings.stripe.configured'
      : 'admin.settings.stripe.missing';
  }

  protected statusKey(f: FeatureFlag): string {
    if (!f.isActive) return 'admin.settings.flags.statusArchived';
    return f.value.enabled
      ? 'admin.settings.flags.statusOn'
      : 'admin.settings.flags.statusOff';
  }

  protected statusVariant(f: FeatureFlag): 'success' | 'neutral' | 'warning' {
    if (!f.isActive) return 'neutral';
    return f.value.enabled ? 'success' : 'warning';
  }

  protected summary(f: FeatureFlag): string {
    return variantSummary(f.value.variants);
  }

  protected fieldError(key: string): string | null {
    const k = this.fieldErrors()[key];
    return k ? this.i18n.t(k) : null;
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.flags.set((await this.flagsClient.list()).items);
    } catch (err) {
      this.flags.set(null);
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected async loadStripe(): Promise<void> {
    this.stripeError.set(null);
    try {
      this.stripe.set(await this.billing.stripeStatus());
    } catch (err) {
      this.stripeError.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected startNew(): void {
    this.draft = emptyDraft();
    this.fieldErrors.set({});
    this.formError.set(null);
    this.editing.set('new');
  }

  protected startEdit(f: FeatureFlag): void {
    this.draft = draftFrom(f);
    this.fieldErrors.set({});
    this.formError.set(null);
    this.editing.set('edit');
  }

  protected addVariant(): void {
    this.draft.variants = [...this.draft.variants, { key: '', weight: 1 }];
  }

  protected removeVariant(i: number): void {
    this.draft.variants = this.draft.variants.filter((_, j) => j !== i);
  }

  protected async save(ev: Event): Promise<void> {
    ev.preventDefault();
    const isNew = this.editing() === 'new';
    const errs = validateFlag(this.draft, isNew);
    this.fieldErrors.set(errs);
    if (Object.keys(errs).length) return;
    this.saving.set(true);
    this.formError.set(null);
    const body: CreateFeatureFlagBody = {
      key: this.draft.key.trim(),
      value: valueFrom(this.draft),
      description: this.draft.description.trim() || null,
      isActive: this.draft.isActive,
    };
    try {
      const saved = isNew
        ? await this.flagsClient.create(body)
        : await this.flagsClient.update(body.key, {
            value: body.value,
            description: body.description,
            isActive: body.isActive,
          });
      this.flags.update((rows) =>
        [...(rows ?? []).filter((r) => r.key !== saved.key), saved].sort(
          (a, b) => a.key.localeCompare(b.key),
        ),
      );
      this.editing.set(null);
      this.toast.success(
        this.i18n.t('admin.settings.flags.saved', { key: saved.key }),
      );
    } catch (err) {
      this.formError.set(this.errors.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(f: FeatureFlag): Promise<void> {
    if (f.builtIn) return;
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: f.key }),
      message: this.i18n.t('admin.settings.flags.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
    });
    if (!ok) return;
    const before = this.flags();
    this.flags.update((rows) => (rows ?? []).filter((r) => r.key !== f.key));
    try {
      await this.flagsClient.remove(f.key);
      this.toast.success(
        this.i18n.t('admin.settings.flags.deleted', { key: f.key }),
      );
    } catch (err) {
      this.flags.set(before);
      this.errors.toast(err, 'admin.errors.actionFailed');
    }
  }
}
