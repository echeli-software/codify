import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Avatar,
  Badge,
  Button,
  FormField,
  Icon,
  Input,
  KeyValueList,
  Select,
  ThemeService,
  type KeyValueRow,
  type SelectOption,
  type ThemeMode,
} from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';
import { I18nService, TranslatePipe, type Locale } from '@codify/i18n';
import { MeClient } from '@codify/api-client';
import { AdminErrors } from '../core/errors';

/**
 * Admin profile — display name, UI language, theme and identity. In Clerk
 * mode account security (email, password, MFA) is managed in Clerk's own
 * profile modal (`openUserProfile()`); the language switch goes through
 * `I18nService.changeLocale`, which persists to `PATCH /me` via
 * LOCALE_PERSISTENCE.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Avatar,
    Badge,
    Button,
    FormField,
    Icon,
    Input,
    KeyValueList,
    Select,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page admin-page--narrow">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.profile.title' | translate }}</h1>
          <p class="muted">{{ 'admin.profile.subtitle' | translate }}</p>
        </div>
      </header>

      @if (user(); as u) {
        <section class="admin-card">
          <header class="profile-hero">
            <cdf-avatar [name]="u.displayName" size="lg" />
            <div>
              <h2>{{ u.displayName }}</h2>
              <p class="muted small">{{ u.email }}</p>
              <cdf-badge variant="info" [subtle]="true">{{
                'admin.roles.' + u.role | translate
              }}</cdf-badge>
            </div>
          </header>
          @if (clerkMode) {
            <div class="form-actions">
              <cdf-button kind="secondary" (click)="openAccount()">
                <cdf-icon name="user-circle" size="sm" />
                {{ 'admin.profile.manageAccount' | translate }}
              </cdf-button>
            </div>
          }
        </section>

        <section class="admin-card">
          <h3>{{ 'admin.profile.account' | translate }}</h3>
          <div class="form-grid form-grid--2">
            <cdf-form-field
              [label]="'admin.profile.displayName' | translate"
              controlId="profile-name"
              [error]="nameError()"
            >
              <cdf-input
                inputId="profile-name"
                [(ngModel)]="displayNameModel"
                [invalid]="!!nameError()"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.profile.language' | translate"
              controlId="profile-locale"
            >
              <cdf-select
                inputId="profile-locale"
                [options]="localeOptions"
                [ngModel]="i18n.currentLocale()"
                (ngModelChange)="onLocaleChange($event)"
              />
            </cdf-form-field>
          </div>
          <div class="form-actions">
            <cdf-button
              kind="primary"
              [loading]="saving()"
              [disabled]="displayNameModel.trim() === u.displayName"
              (click)="saveName()"
            >
              {{ 'admin.common.save' | translate }}
            </cdf-button>
            @if (status(); as s) {
              <span class="muted small" role="status">{{
                'admin.profile.status.' + s | translate
              }}</span>
            }
          </div>
        </section>

        <section class="admin-card">
          <h3>{{ 'admin.profile.appearance' | translate }}</h3>
          <cdf-form-field
            [label]="'admin.profile.theme' | translate"
            [help]="'admin.profile.themeHelp' | translate"
            controlId="profile-theme"
          >
            <cdf-select
              inputId="profile-theme"
              [options]="themeOptions()"
              [ngModel]="themeService.mode()"
              (ngModelChange)="onThemeChange($event)"
            />
          </cdf-form-field>
        </section>

        <section class="admin-card">
          <h3>{{ 'admin.profile.identity' | translate }}</h3>
          <cdf-key-value-list [rows]="identityRows()" />
          <div class="form-actions">
            <cdf-button kind="danger" (click)="signOut()">
              {{ 'admin.shell.signOut' | translate }}
            </cdf-button>
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .profile-hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        h2 {
          margin: 0;
          font-size: var(--cdf-font-size-lg);
        }
        p {
          margin: 0 0 4px;
        }
      }
    `,
  ],
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly me = inject(MeClient);
  private readonly errors = inject(AdminErrors);
  protected readonly themeService = inject(ThemeService);

  protected readonly clerkMode = this.auth.mode === 'clerk';
  protected readonly user = computed(() => this.auth.user());
  protected displayNameModel = '';
  protected readonly saving = signal(false);
  protected readonly nameError = signal<string | null>(null);
  protected readonly status = signal<'saved' | 'languageSaved' | null>(null);

  protected readonly localeOptions: SelectOption<Locale>[] =
    this.i18n.availableLocales.map((m) => ({
      value: m.code,
      label: m.nativeName,
    }));

  protected readonly themeOptions = computed<SelectOption<ThemeMode>[]>(() => {
    this.i18n.currentLocale();
    return (['system', 'light', 'dark'] as const).map((m) => ({
      value: m,
      label: this.i18n.t(`admin.profile.themes.${m}`),
    }));
  });

  protected readonly identityRows = computed<KeyValueRow[]>(() => {
    this.i18n.currentLocale();
    const u = this.user();
    if (!u) return [];
    return [
      { key: this.i18n.t('admin.profile.userId'), value: u.id },
      { key: this.i18n.t('admin.profile.email'), value: u.email },
      {
        key: this.i18n.t('admin.profile.role'),
        value: this.i18n.t(`admin.roles.${u.role}`),
      },
      { key: this.i18n.t('admin.profile.locale'), value: u.locale ?? '—' },
    ];
  });

  constructor() {
    let seeded = false;
    effect(() => {
      const u = this.user();
      if (u && !seeded) {
        seeded = true;
        this.displayNameModel = u.displayName;
      }
    });
    void this.syncFromApi();
  }

  /** Pull the server profile (display name / locale) on open. */
  private async syncFromApi(): Promise<void> {
    try {
      const me = await this.me.me();
      this.auth.updateProfile({
        displayName: me.displayName,
        locale: me.locale,
      });
      this.displayNameModel = me.displayName;
    } catch (err) {
      this.errors.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async saveName(): Promise<void> {
    const next = this.displayNameModel.trim();
    if (!next) {
      this.nameError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.nameError.set(null);
    this.saving.set(true);
    try {
      const me = await this.me.update({ displayName: next });
      this.auth.updateProfile({ displayName: me.displayName });
      this.status.set('saved');
    } catch (err) {
      this.nameError.set(this.errors.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async onLocaleChange(value: Locale | null): Promise<void> {
    if (!value || value === this.i18n.currentLocale()) return;
    await this.i18n.changeLocale(value);
    this.status.set('languageSaved');
  }

  protected onThemeChange(mode: ThemeMode | null): void {
    if (mode) this.themeService.setMode(mode);
  }

  protected openAccount(): void {
    this.auth.openUserProfile();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
