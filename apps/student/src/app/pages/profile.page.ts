import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
} from '@ionic/angular/standalone';
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppInput,
  AppSelect,
  type AppSelectOption,
  AppToggle,
  FormField,
  Icon,
} from '@codify/ui-ionic';
import { AuthService } from '@codify/auth';
import { I18nService, type Locale } from '@codify/i18n';
import { MeClient, ProblemDetailsError } from '@codify/api-client';

type ThemeMode = 'light' | 'dark' | 'system';
const THEME_KEY = 'codify.theme';

/**
 * Profile page — display name + locale + theme + role + sign out. Fulfils
 * the "profile basics in both apps" deliverable from Phase 4. Edits to
 * `displayName` / `locale` go through `AuthService.updateProfile()` so the
 * topbar avatar reflects the change instantly. Theme is owned locally and
 * persisted to `codify.theme` (same key the today.page header reads).
 *
 * Real Clerk-managed profile (avatar upload, password reset) lands later
 * with the Clerk SDK swap.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    RouterLink,
    AppAvatar,
    AppBadge,
    AppButton,
    AppCard,
    AppInput,
    AppSelect,
    AppToggle,
    FormField,
    Icon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (user(); as u) {
      <cdf-app-card padding="spacious">
        <header class="profile-hero">
          <cdf-app-avatar [name]="u.displayName" size="lg" />
          <div class="profile-hero__copy">
            <h2>{{ u.displayName }}</h2>
            <p class="muted">{{ u.email }}</p>
            <cdf-app-badge variant="primary" [subtle]="true">{{ u.role }}</cdf-app-badge>
          </div>
        </header>
      </cdf-app-card>

      <h2>Account</h2>
      <cdf-app-card padding="normal">
        <cdf-form-field label="Display name">
          <cdf-app-input
            [(ngModel)]="displayNameModel"
            (ngModelChange)="onDisplayNameChange($event)"
          />
        </cdf-form-field>

        <cdf-form-field label="Language" style="margin-top: 12px;">
          <cdf-app-select
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
        <p class="profile-sync profile-sync--syncing">
          <cdf-icon name="hourglass" size="sm" /> Syncing with server…
        </p>
        }
        @if (apiSyncStatus() === 'offline') {
        <p class="profile-sync profile-sync--offline">
          <cdf-icon name="cloud-offline" size="sm" /> API offline — changes saved locally.
        </p>
        }
      </cdf-app-card>

      <h2>Membership</h2>
      <cdf-app-card padding="normal">
        <ion-list inset="false">
          <ion-item button [routerLink]="['/subscription']" lines="none" detail="true" data-testid="subscription-link">
            <cdf-icon name="diamond" slot="start" size="md" />
            <ion-label>
              <h3>Subscription</h3>
              <p>Manage your plan, billing, and trial</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </cdf-app-card>

      <h2>Storage</h2>
      <cdf-app-card padding="normal">
        <ion-list inset="false">
          <ion-item button [routerLink]="['/downloads']" lines="none" detail="true" data-testid="downloads-link">
            <cdf-icon name="download" slot="start" size="md" />
            <ion-label>
              <h3>Downloads</h3>
              <p>Manage offline courses, storage, and sync</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </cdf-app-card>

      <h2>Appearance</h2>
      <cdf-app-card padding="normal">
        <cdf-form-field label="Theme" hint="System follows your OS preference.">
          <cdf-app-select
            [options]="themeOptions"
            [ngModel]="themeMode()"
            (ngModelChange)="onThemeChange($event)"
          />
        </cdf-form-field>

        <cdf-app-toggle
          [(ngModel)]="reduceMotionModel"
          (ngModelChange)="onReduceMotionChange($event)"
          label="Reduce motion (skip celebrations)"
        />
      </cdf-app-card>

      <h2>Session</h2>
      <cdf-app-card padding="normal">
        <ion-list inset="false">
          <ion-item lines="none">
            <ion-label>
              <h3>Signed in as</h3>
              <p>{{ u.email }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
        <cdf-app-button kind="danger" (buttonClick)="signOut()">
          Sign out
        </cdf-app-button>
      </cdf-app-card>
      }
    </ion-content>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 640px;
        margin: 0 auto;
      }
      .profile-hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
      }
      .profile-hero__copy {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .profile-hero__copy h2 {
        margin: 0;
        font-size: var(--cdf-font-size-lg);
        font-weight: 700;
      }
      .muted {
        color: var(--cdf-color-text-muted);
        font-size: 13px;
        margin: 0;
      }
      h2 {
        margin: var(--cdf-space-5) 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
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
        display: flex;
        align-items: center;
        gap: 6px;
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

  protected readonly user = computed(() => this.auth.user());
  protected displayNameModel = '';
  protected reduceMotionModel = false;
  protected readonly apiSyncStatus = signal<'idle' | 'syncing' | 'offline'>('idle');

  protected readonly localeOptions: AppSelectOption<Locale>[] =
    this.i18n.availableLocales.map((m) => ({ value: m.code, label: m.nativeName }));

  protected readonly themeOptions: AppSelectOption<ThemeMode>[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected readonly localeModel = computed<Locale>(
    () => (this.user()?.locale as Locale | undefined) ?? this.i18n.currentLocale(),
  );

  protected readonly themeMode = signal<ThemeMode>(this.readPersistedTheme());
  protected readonly savedLabel = signal<string | null>(null);
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Sync displayNameModel from the authoritative AuthService user when it
    // (re)hydrates — `effect` reacts to user signal changes.
    effect(() => {
      const u = this.user();
      if (u) this.displayNameModel = u.displayName;
    });

    this.applyTheme(this.themeMode());
    void this.syncFromApi();
  }

  /**
   * Pull canonical /api/me on mount. Falls back silently when the API
   * is offline so dev work without a running NestJS instance still
   * loads the page (state stays from AuthService.localStorage).
   */
  private async syncFromApi(): Promise<void> {
    this.apiSyncStatus.set('syncing');
    try {
      const me = await this.meClient.me();
      // Mirror server canonical state into AuthService — locale + display
      // name are the only fields the user can edit, but the response
      // also tells us about server-side patches (admin-driven role bumps,
      // for example) so we trust it as the source of truth.
      this.auth.updateProfile({
        displayName: me.displayName,
        locale: me.locale,
      });
      if (me.locale && me.locale !== this.i18n.currentLocale()) {
        this.i18n.setLocale(me.locale as Locale);
      }
      this.apiSyncStatus.set('idle');
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isUnauthorized) {
        // Auth interceptor already cleared the session — guard will redirect.
        return;
      }
      this.apiSyncStatus.set('offline');
    }
  }

  protected onDisplayNameChange(value: string): void {
    const next = value.trim();
    if (!next) return;
    // Optimistic local update so the topbar avatar reflects instantly.
    this.auth.updateProfile({ displayName: next });
    this.flashSaved('Display name saved');
    void this.persistToApi({ displayName: next });
  }

  protected onLocaleChange(value: Locale | null): void {
    if (!value) return;
    this.i18n.setLocale(value);
    this.auth.updateProfile({ locale: value });
    this.flashSaved('Language updated');
    void this.persistToApi({ locale: value });
  }

  /** Best-effort PATCH /api/me. Errors flip the offline indicator. */
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

  protected onThemeChange(mode: ThemeMode | null): void {
    if (!mode) return;
    this.themeMode.set(mode);
    this.applyTheme(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* private browsing — ignore */
    }
  }

  protected onReduceMotionChange(value: boolean): void {
    try {
      localStorage.setItem('codify.motion', value ? 'off' : 'system');
    } catch {
      /* ignore */
    }
  }

  protected signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }

  private applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (mode === 'light') root.classList.add('theme-light');
    if (mode === 'dark') root.classList.add('theme-dark');
  }

  private readPersistedTheme(): ThemeMode {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }

  private flashSaved(label: string): void {
    this.savedLabel.set(label);
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => this.savedLabel.set(null), 1800);
  }
}
