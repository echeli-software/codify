import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Button,
  Checkbox,
  FormField,
  Input,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  GamificationClient,
  type GamificationConfigEntry,
  type GamificationConfigPatch,
  type Multiplier,
  type SiteSettingsAdmin,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../core/load-error';
import { SiteConfigService } from '../core/site-config';
import { stableStringify } from '../core/dirty';
import {
  isCoinRateKey,
  numericLeaves,
  withLeaves,
  type ConfigLeaf,
} from '../core/config-leaves';

const ALL_LOCALES = ['pt-BR', 'en-US'] as const;
const DEFAULT_LOCALE = 'pt-BR';
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface RateRow {
  key: string;
  leaves: ConfigLeaf[];
  defaultValue: unknown;
  value: unknown;
  isDefault: boolean;
}

/**
 * Settings sections owned by the catalog side (docs/04 Settings):
 * branding colour overrides + environment label, locale enable/disable,
 * default coin rates (every `earning.*` / `coins.*` gamification config
 * key, edited generically) with the `PREMIUM_DEFAULT` multiplier, and a
 * note on notification template defaults. Feature flags and Stripe status
 * live on the settings page itself.
 */
@Component({
  selector: 'cdf-settings-site',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Button,
    Checkbox,
    FormField,
    Input,
    Skeleton,
    LoadError,
    TranslatePipe,
  ],
  template: `
    <section
      class="admin-card"
      aria-labelledby="branding-title"
      data-testid="settings-branding"
    >
      <h2 id="branding-title">
        {{ 'admin.siteSettings.branding.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.siteSettings.branding.help' | translate }}
      </p>
      @if (error(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="load()" />
      } @else if (settings() === null) {
        <cdf-skeleton shape="rect" height="120px" />
      } @else {
        <div class="token-grid">
          @for (t of tokens(); track t) {
            <div class="token">
              <label [for]="'tok-' + t" class="small mono">{{ t }}</label>
              <span class="token-inputs">
                <input
                  type="color"
                  class="form-control form-control-color"
                  [attr.aria-label]="
                    'admin.siteSettings.branding.pick' | translate: { token: t }
                  "
                  [ngModel]="colors[t] || '#7c4dff'"
                  (ngModelChange)="colors[t] = $event"
                />
                <input
                  [id]="'tok-' + t"
                  class="form-control form-control-sm mono"
                  [placeholder]="
                    'admin.siteSettings.branding.inherit' | translate
                  "
                  [(ngModel)]="colors[t]"
                  [attr.aria-invalid]="
                    colors[t] && !isHex(colors[t]) ? true : null
                  "
                />
              </span>
            </div>
          }
        </div>
        <cdf-form-field
          [label]="'admin.siteSettings.branding.label' | translate"
          [help]="'admin.siteSettings.branding.labelHelp' | translate"
          controlId="site-label"
        >
          <cdf-input inputId="site-label" [(ngModel)]="label" />
        </cdf-form-field>
        @if (brandingProblem()) {
          <p class="form-error" role="alert">
            {{ 'admin.siteSettings.branding.invalid' | translate }}
          </p>
        }
        <div class="form-actions">
          <cdf-button
            kind="primary"
            size="sm"
            [loading]="busy() === 'branding'"
            (click)="saveBranding()"
            data-testid="save-branding"
          >
            {{ 'admin.common.saveChanges' | translate }}
          </cdf-button>
          <cdf-button kind="ghost" size="sm" (click)="resetBranding()">
            {{ 'admin.siteSettings.branding.reset' | translate }}
          </cdf-button>
        </div>
      }
    </section>

    <section
      class="admin-card"
      aria-labelledby="locales-title"
      data-testid="settings-locales"
    >
      <h2 id="locales-title">
        {{ 'admin.siteSettings.locales.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.siteSettings.locales.help' | translate }}
      </p>
      @if (settings()) {
        <ul class="plain-list">
          @for (l of allLocales; track l) {
            <li>
              <cdf-checkbox
                [ngModel]="enabled.includes(l)"
                (ngModelChange)="toggleLocale(l, $event)"
                [disabled]="l === defaultLocale"
                [label]="
                  l +
                  (l === defaultLocale
                    ? ' · ' + ('admin.siteSettings.locales.default' | translate)
                    : '')
                "
              />
            </li>
          }
        </ul>
        <div class="form-actions">
          <cdf-button
            kind="primary"
            size="sm"
            [loading]="busy() === 'locales'"
            (click)="saveLocales()"
            data-testid="save-locales"
          >
            {{ 'admin.common.saveChanges' | translate }}
          </cdf-button>
        </div>
      }
    </section>

    <section
      class="admin-card"
      aria-labelledby="rates-title"
      data-testid="settings-rates"
    >
      <h2 id="rates-title">
        {{ 'admin.siteSettings.rates.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.siteSettings.rates.help' | translate }}
        <a
          [routerLink]="['/gamification']"
          [queryParams]="{ tab: 'defaults' }"
          >{{ 'admin.siteSettings.rates.allDefaults' | translate }}</a
        >
      </p>
      @if (ratesError(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="loadRates()" />
      } @else if (rates() === null) {
        <cdf-skeleton shape="rect" height="120px" />
      } @else {
        <div class="premium">
          <cdf-form-field
            [label]="'admin.siteSettings.rates.premium' | translate"
            [help]="'admin.siteSettings.rates.premiumHelp' | translate"
            controlId="premium-default"
          >
            <cdf-input
              inputId="premium-default"
              type="number"
              [(ngModel)]="premiumValue"
            />
          </cdf-form-field>
          <cdf-button
            kind="secondary"
            size="sm"
            [loading]="busy() === 'premium'"
            (click)="savePremium()"
            data-testid="save-premium"
          >
            {{ 'admin.common.saveChanges' | translate }}
          </cdf-button>
        </div>
        @for (r of rates(); track r.key) {
          <fieldset class="rate">
            <legend class="mono small">{{ r.key }}</legend>
            <div class="leaf-grid">
              @for (leaf of r.leaves; track leaf.path) {
                <label class="leaf small">
                  <span class="mono">{{ leaf.path || r.key }}</span>
                  <input
                    class="form-control form-control-sm"
                    type="number"
                    min="0"
                    [(ngModel)]="leaf.value"
                  />
                </label>
              }
            </div>
          </fieldset>
        } @empty {
          <p class="muted small">
            {{ 'admin.siteSettings.rates.none' | translate }}
          </p>
        }
        @if (rates()!.length) {
          <div class="form-actions">
            <cdf-button
              kind="primary"
              size="sm"
              [loading]="busy() === 'rates'"
              (click)="saveRates()"
              data-testid="save-rates"
            >
              {{ 'admin.common.saveChanges' | translate }}
            </cdf-button>
          </div>
        }
      }
    </section>

    <section class="admin-card" aria-labelledby="templates-title">
      <h2 id="templates-title">
        {{ 'admin.siteSettings.templates.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.siteSettings.templates.body' | translate }}
      </p>
    </section>
  `,
  styles: [
    `
      .token-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .token {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .token-inputs {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .form-control-color {
        width: 44px;
        flex-shrink: 0;
      }
      .premium {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .rate {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        margin-bottom: var(--cdf-space-2);
        legend {
          float: none;
          width: auto;
          padding: 0 4px;
          margin: 0;
        }
      }
      .leaf-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--cdf-space-2);
      }
      .leaf {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
    `,
  ],
})
export class SettingsSite {
  private readonly client = inject(AdminCatalogClient);
  private readonly gamification = inject(GamificationClient);
  private readonly site = inject(SiteConfigService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly allLocales = ALL_LOCALES;
  protected readonly defaultLocale = DEFAULT_LOCALE;
  protected readonly settings = signal<SiteSettingsAdmin | null>(null);
  protected readonly error = signal<unknown>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly tokens = computed(
    () => this.settings()?.brandingTokens ?? [],
  );
  protected colors: Record<string, string> = {};
  protected label = '';
  protected enabled: string[] = [...ALL_LOCALES];
  protected readonly brandingProblem = signal(false);

  protected readonly rates = signal<RateRow[] | null>(null);
  protected readonly ratesError = signal<unknown>(null);
  private premium: Multiplier | null = null;
  protected premiumValue = 1.5;
  private clean = '';

  constructor() {
    void this.load();
    void this.loadRates();
  }

  private snapshot(): string {
    return stableStringify({
      c: this.colors,
      l: this.label,
      e: this.enabled,
      r: this.rates()?.map((r) => r.leaves),
      p: this.premiumValue,
    });
  }

  hasUnsavedChanges(): boolean {
    return this.clean !== '' && this.snapshot() !== this.clean;
  }

  private markClean(): void {
    this.clean = this.snapshot();
  }

  protected isHex(v: string): boolean {
    return HEX.test(v);
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      this.fill(await this.client.siteSettings());
    } catch (err) {
      this.error.set(err);
    }
  }

  private fill(s: SiteSettingsAdmin): void {
    this.settings.set(s);
    this.colors = Object.fromEntries(
      s.brandingTokens.map((t) => [t, s.branding.tokens[t] ?? '']),
    );
    this.label = s.branding.label ?? '';
    this.enabled = [...s.locales.enabled];
    this.markClean();
  }

  protected resetBranding(): void {
    this.colors = Object.fromEntries(this.tokens().map((t) => [t, '']));
    this.label = '';
  }

  protected async saveBranding(): Promise<void> {
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.colors)) {
      const val = v.trim();
      if (!val) continue;
      if (!HEX.test(val)) {
        this.brandingProblem.set(true);
        return;
      }
      tokens[k] = val;
    }
    this.brandingProblem.set(false);
    await this.save('branding', {
      branding: { tokens, label: this.label.trim() || null },
    });
  }

  protected toggleLocale(l: string, on: boolean): void {
    this.enabled = on
      ? [...new Set([...this.enabled, l])]
      : this.enabled.filter((x) => x !== l);
  }

  protected async saveLocales(): Promise<void> {
    await this.save('locales', { enabledLocales: this.enabled });
  }

  private async save(
    what: 'branding' | 'locales',
    body: Parameters<AdminCatalogClient['updateSiteSettings']>[0],
  ): Promise<void> {
    this.busy.set(what);
    try {
      const s = await this.client.updateSiteSettings(body);
      this.fill(s);
      this.site.apply(s); // apply to this tab right away
      this.toast.success(this.i18n.t('admin.siteSettings.saved'));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  // ─── Coin rates + PREMIUM_DEFAULT ─────────────────────────────────────

  async loadRates(): Promise<void> {
    this.ratesError.set(null);
    try {
      const [entries, multipliers] = await Promise.all([
        this.gamification.getConfig(),
        this.gamification.listMultipliers(),
      ]);
      this.rates.set(this.rateRows(entries));
      this.premium =
        multipliers.find(
          (m) => m.kind === 'PREMIUM_DEFAULT' && !m.courseId && !m.lessonId,
        ) ?? null;
      this.premiumValue = this.premium?.value ?? 1.5;
      this.markClean();
    } catch (err) {
      this.ratesError.set(err);
    }
  }

  private rateRows(entries: GamificationConfigEntry[]): RateRow[] {
    return entries
      .filter((e) => isCoinRateKey(e.key))
      .map((e) => ({
        key: e.key,
        leaves: numericLeaves(e.value) ?? [],
        defaultValue: e.defaultValue,
        value: e.value,
        isDefault: e.isDefault,
      }))
      .filter((r) => r.leaves.length > 0);
  }

  protected async saveRates(): Promise<void> {
    const rows = this.rates() ?? [];
    const patch: Record<string, unknown> = {};
    for (const r of rows) {
      const next = withLeaves(
        r.value,
        r.leaves.map((l) => ({ ...l, value: Number(l.value) })),
      );
      if (stableStringify(next) !== stableStringify(r.value))
        patch[r.key] = next;
    }
    if (Object.keys(patch).length === 0) {
      this.toast.success(this.i18n.t('admin.siteSettings.rates.unchanged'));
      return;
    }
    this.busy.set('rates');
    try {
      const entries = await this.gamification.updateConfig(
        patch as GamificationConfigPatch,
      );
      this.rates.set(this.rateRows(entries));
      this.markClean();
      this.toast.success(this.i18n.t('admin.siteSettings.saved'));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  /** `PREMIUM_DEFAULT` lives in a Multiplier row (docs/04 Settings). */
  protected async savePremium(): Promise<void> {
    const value = Number(this.premiumValue);
    if (!Number.isFinite(value) || value < 1) {
      this.toast.error(this.i18n.t('admin.siteSettings.rates.premiumInvalid'));
      return;
    }
    this.busy.set('premium');
    try {
      this.premium = this.premium
        ? await this.gamification.updateMultiplier(this.premium.id, {
            value,
            isActive: true,
          })
        : await this.gamification.createMultiplier({
            kind: 'PREMIUM_DEFAULT',
            target: 'BOTH',
            value,
            isActive: true,
          });
      this.markClean();
      this.toast.success(this.i18n.t('admin.siteSettings.saved'));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }
}
