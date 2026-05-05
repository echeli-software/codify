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
  type SelectOption,
  type ThemeMode,
} from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';
import { I18nService, type Locale } from '@codify/i18n';
import { MeClient, ProblemDetailsError } from '@codify/api-client';

/**
 * Admin Profile page — display name + locale + theme + role + email + sign
 * out. Mirrors the student profile but uses ui-bootstrap chrome since
 * staff-side runs in the admin design system.
 *
 * The signed-in user is sourced from AuthService; edits go through
 * `updateProfile()` so the topbar avatar in ShellPage reflects them.
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
  ],
  template: `
    <div class="profile-page">
      <header class="profile-page__header">
        <h1>Profile</h1>
        <p class="text-muted">Display name, language, and appearance.</p>
      </header>

      @if (user(); as u) {
      <section class="card">
        <header class="profile-hero">
          <cdf-avatar [name]="u.displayName" size="lg" />
          <div>
            <h2>{{ u.displayName }}</h2>
            <p class="muted">{{ u.email }}</p>
            <cdf-badge variant="info" [subtle]="true">{{ u.role }}</cdf-badge>
          </div>
        </header>
      </section>

      <section class="card">
        <h3>Account</h3>
        <cdf-form-field label="Display name">
          <cdf-input
            [(ngModel)]="displayNameModel"
            (ngModelChange)="onDisplayNameChange($event)"
          />
        </cdf-form-field>

        <cdf-form-field label="Language" style="margin-top: 12px;">
          <cdf-select
            [options]="localeOptions"
            [ngModel]="localeModel()"
            (ngModelChange)="onLocaleChange($event)"
          />
        </cdf-form-field>

        @if (savedLabel()) {
        <p class="profile-saved">
          <cdf-icon name="check-circle" size="sm" /> {{ savedLabel() }}
        </p>
        }
        @if (apiSyncStatus() === 'syncing') {
        <p class="profile-sync profile-sync--syncing">Syncing with server…</p>
        }
        @if (apiSyncStatus() === 'offline') {
        <p class="profile-sync profile-sync--offline">
          API offline — changes saved locally.
        </p>
        }
      </section>

      <section class="card">
        <h3>Appearance</h3>
        <cdf-form-field label="Theme" hint="System follows your OS preference.">
          <cdf-select
            [options]="themeOptions"
            [ngModel]="themeService.mode()"
            (ngModelChange)="onThemeChange($event)"
          />
        </cdf-form-field>
      </section>

      <section class="card">
        <h3>Identity</h3>
        <cdf-key-value-list
          [rows]="identityRows()"
        />
        <div style="margin-top: 12px; display:flex; gap:8px;">
          <cdf-button kind="danger" (click)="signOut()">Sign out</cdf-button>
        </div>
      </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 720px;
        margin: 0 auto;
      }
      .profile-page__header h1 {
        margin: 0;
        font-size: var(--cdf-font-size-xl);
      }
      .profile-page__header p {
        margin: 4px 0 var(--cdf-space-4);
      }
      .card {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-4);
        margin-bottom: var(--cdf-space-4);
      }
      .card h3 {
        margin: 0 0 var(--cdf-space-3);
        font-size: var(--cdf-font-size-md);
      }
      .profile-hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        h2 {
          margin: 0;
          font-size: var(--cdf-font-size-lg);
        }
      }
      .muted {
        color: var(--cdf-color-text-muted);
        font-size: 13px;
        margin: 0 0 4px;
      }
      .profile-saved {
        margin: var(--cdf-space-2) 0 0;
        color: var(--cdf-color-success);
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .profile-sync {
        margin: var(--cdf-space-2) 0 0;
        font-size: 13px;
      }
      .profile-sync--syncing {
        color: var(--cdf-color-text-muted);
      }
      .profile-sync--offline {
        color: var(--cdf-color-warning);
      }
    `,
  ],
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly meClient = inject(MeClient);
  protected readonly themeService = inject(ThemeService);

  protected readonly user = computed(() => this.auth.user());
  protected displayNameModel = '';
  protected readonly apiSyncStatus = signal<'idle' | 'syncing' | 'offline'>('idle');

  protected readonly localeOptions: SelectOption<Locale>[] =
    this.i18n.availableLocales.map((m) => ({ value: m.code, label: m.nativeName }));

  protected readonly themeOptions: SelectOption<ThemeMode>[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected readonly localeModel = computed<Locale>(
    () => (this.user()?.locale as Locale | undefined) ?? this.i18n.currentLocale(),
  );

  protected readonly identityRows = computed(() => {
    const u = this.user();
    if (!u) return [];
    return [
      { key: 'User ID', value: u.id },
      { key: 'Email', value: u.email },
      { key: 'Role', value: u.role },
      { key: 'Locale', value: u.locale ?? '—' },
    ];
  });

  protected readonly savedLabel = signal<string | null>(null);
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const u = this.user();
      if (u) this.displayNameModel = u.displayName;
    });
    void this.syncFromApi();
  }

  /** Pull /api/me on mount; fall back silently when API offline. */
  private async syncFromApi(): Promise<void> {
    this.apiSyncStatus.set('syncing');
    try {
      const me = await this.meClient.me();
      this.auth.updateProfile({
        displayName: me.displayName,
        locale: me.locale,
      });
      if (me.locale && me.locale !== this.i18n.currentLocale()) {
        this.i18n.setLocale(me.locale as Locale);
      }
      this.apiSyncStatus.set('idle');
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isUnauthorized) return;
      this.apiSyncStatus.set('offline');
    }
  }

  protected onDisplayNameChange(value: string): void {
    const next = value.trim();
    if (!next) return;
    this.auth.updateProfile({ displayName: next });
    this.flashSaved('Display name saved');
    void this.persistToApi({ displayName: next });
  }

  /** Best-effort PATCH /api/me. */
  private async persistToApi(patch: {
    displayName?: string;
    locale?: string;
  }): Promise<void> {
    try {
      await this.meClient.update(patch);
      this.apiSyncStatus.set('idle');
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isUnauthorized) return;
      this.apiSyncStatus.set('offline');
    }
  }

  protected onLocaleChange(value: Locale | null): void {
    if (!value) return;
    this.i18n.setLocale(value);
    this.auth.updateProfile({ locale: value });
    this.flashSaved('Language updated');
    void this.persistToApi({ locale: value });
  }

  protected onThemeChange(mode: ThemeMode | null): void {
    if (mode) this.themeService.setMode(mode);
  }

  protected signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }

  private flashSaved(label: string): void {
    this.savedLabel.set(label);
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => this.savedLabel.set(null), 1800);
  }
}
