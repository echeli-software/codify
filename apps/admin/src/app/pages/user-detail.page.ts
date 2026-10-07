import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Avatar,
  Badge,
  type BadgeVariant,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Combobox,
  type ComboboxOption,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  BillingClient,
  CoursesClient,
  EnrollmentsClient,
  PlansClient,
  ProblemDetailsError,
  UsersClient,
  type AdminSubscriptionView,
  type EnrollmentView,
  type MeResponse,
  type Plan,
  type SubscriptionStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { localToIso } from '../core/catalog';

type Tab = 'profile' | 'subscriptions' | 'enrollments';

/** docs/14 §2: SUPPORT grants are capped at ~1 month. */
export const SUPPORT_MAX_GRANT_DAYS = 31;

const STATUS_VARIANT: Partial<Record<SubscriptionStatus, BadgeVariant>> = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELED: 'neutral',
  UNPAID: 'danger',
};

/** Days between now and a `datetime-local` value (rounded up). */
export function daysUntil(
  local: string | null,
  now = new Date(),
): number | null {
  const iso = localToIso(local);
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/**
 * User detail (docs/04 "Users"): profile, subscriptions (grant a plan for N
 * days — SUPPORT capped at 31 with the API's message shown — and cancel now
 * or at period end) and course enrollments (grant PROMO / ADMIN_GRANT with
 * an access end, revoke). Every mutation carries an audit reason.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Avatar,
    Badge,
    BreadcrumbBar,
    Button,
    Combobox,
    EmptyState,
    FormField,
    Input,
    Select,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />

      @if (user(); as u) {
        <header class="page-head">
          <div class="hero">
            <cdf-avatar [name]="u.displayName" size="lg" />
            <div>
              <h1>{{ u.displayName }}</h1>
              <p class="muted">{{ u.email }}</p>
              <cdf-badge variant="info" [subtle]="true">{{
                'admin.roles.' + u.role | translate
              }}</cdf-badge>
            </div>
          </div>
        </header>

        <div class="tabs" role="tablist">
          @for (t of tabs; track t) {
            <button
              type="button"
              role="tab"
              [id]="'utab-' + t"
              [attr.aria-selected]="tab() === t"
              [attr.aria-controls]="'upanel-' + t"
              (click)="tab.set(t)"
            >
              {{ 'admin.users.tabs.' + t | translate }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('profile') {
            <section
              id="upanel-profile"
              role="tabpanel"
              aria-labelledby="utab-profile"
            >
              <div class="stat-grid">
                <div class="stat">
                  <div class="stat__label">
                    {{ 'admin.users.xp' | translate }}
                  </div>
                  <div class="stat__value">
                    {{ u.totalXp | locale: 'number' }}
                  </div>
                </div>
                <div class="stat">
                  <div class="stat__label">
                    {{ 'admin.users.coins' | translate }}
                  </div>
                  <div class="stat__value">
                    {{ u.coins | locale: 'number' }}
                  </div>
                </div>
              </div>
              <div class="admin-card">
                <dl class="kv">
                  <dt>{{ 'admin.common.id' | translate }}</dt>
                  <dd class="mono">{{ u.id }}</dd>
                  <dt>{{ 'admin.users.locale' | translate }}</dt>
                  <dd>{{ u.locale }}</dd>
                  <dt>{{ 'admin.users.timezone' | translate }}</dt>
                  <dd>{{ u.timezone }}</dd>
                  <dt>{{ 'admin.users.joined' | translate }}</dt>
                  <dd>{{ u.createdAt | locale: 'datetime' }}</dd>
                  <dt>{{ 'admin.users.lastSeen' | translate }}</dt>
                  <dd>
                    {{
                      u.lastSeenAt
                        ? (u.lastSeenAt | locale: 'datetime')
                        : ('admin.users.never' | translate)
                    }}
                  </dd>
                  <dt>{{ 'admin.users.onboarded' | translate }}</dt>
                  <dd>
                    {{
                      u.onboardedAt
                        ? (u.onboardedAt | locale: 'date')
                        : ('admin.common.no' | translate)
                    }}
                  </dd>
                  <dt>{{ 'admin.users.marketing' | translate }}</dt>
                  <dd>
                    {{
                      (u.marketingEmailOptIn
                        ? 'admin.common.yes'
                        : 'admin.common.no'
                      ) | translate
                    }}
                  </dd>
                </dl>
                <p class="muted small">
                  {{ 'admin.users.profileReadOnly' | translate }}
                </p>
              </div>
            </section>
          }
          @case ('subscriptions') {
            <section
              id="upanel-subscriptions"
              role="tabpanel"
              aria-labelledby="utab-subscriptions"
            >
              <div class="admin-card">
                <h2>{{ 'admin.users.subs.title' | translate }}</h2>
                @if (subs() === null) {
                  <cdf-skeleton shape="rect" height="80px" />
                } @else if (subs()!.length === 0) {
                  <p class="muted small">
                    {{ 'admin.users.subs.none' | translate }}
                  </p>
                } @else {
                  <div class="table-scroll">
                    <table class="admin-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.users.subs.plan' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.common.status' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.subs.source' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.subs.period' | translate }}
                          </th>
                          <th scope="col">
                            <span class="visually-hidden">{{
                              'admin.common.actions' | translate
                            }}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (s of subs(); track s.id) {
                          <tr [attr.data-subscription]="s.id">
                            <td>
                              <strong>{{ s.planName }}</strong>
                            </td>
                            <td>
                              <cdf-badge
                                [variant]="statusVariant(s.status)"
                                [subtle]="true"
                                >{{
                                  'admin.users.subs.status.' + s.status
                                    | translate
                                }}</cdf-badge
                              >
                              @if (s.cancelAtPeriodEnd) {
                                <div class="small muted">
                                  {{
                                    'admin.users.subs.endsAtPeriodEnd'
                                      | translate
                                  }}
                                </div>
                              }
                            </td>
                            <td>
                              {{
                                'admin.users.subs.sources.' + s.source
                                  | translate
                              }}
                            </td>
                            <td class="small">
                              {{ s.currentPeriodStart | locale: 'date' }} →
                              {{ s.currentPeriodEnd | locale: 'date' }}
                            </td>
                            <td>
                              @if (cancellable(s)) {
                                @if (cancelFor() === s.id) {
                                  <div class="cancel-form">
                                    <cdf-select
                                      [ariaLabel]="
                                        'admin.users.subs.cancelMode'
                                          | translate
                                      "
                                      [options]="cancelModeOptions()"
                                      [(ngModel)]="cancelMode"
                                    />
                                    <cdf-input
                                      [ariaLabel]="
                                        'admin.common.reason' | translate
                                      "
                                      [placeholder]="
                                        'admin.common.reason' | translate
                                      "
                                      [(ngModel)]="cancelReason"
                                    />
                                    <div class="row-actions">
                                      <cdf-button
                                        kind="danger"
                                        size="sm"
                                        [loading]="busy() === 'cancel'"
                                        (click)="cancel(s)"
                                        >{{
                                          'admin.users.subs.confirmCancel'
                                            | translate
                                        }}</cdf-button
                                      >
                                      <cdf-button
                                        kind="ghost"
                                        size="sm"
                                        (click)="cancelFor.set(null)"
                                        >{{
                                          'admin.common.close' | translate
                                        }}</cdf-button
                                      >
                                    </div>
                                  </div>
                                } @else {
                                  <cdf-button
                                    kind="secondary"
                                    size="sm"
                                    (click)="openCancel(s)"
                                    >{{
                                      'admin.users.subs.cancel' | translate
                                    }}</cdf-button
                                  >
                                }
                              } @else if (
                                s.source === 'APPLE_IAP' ||
                                s.source === 'GOOGLE_PLAY'
                              ) {
                                <span class="muted small">{{
                                  'admin.users.subs.storeManaged' | translate
                                }}</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>

              <div class="admin-card" aria-labelledby="grant-sub-title">
                <h2 id="grant-sub-title">
                  {{ 'admin.users.subs.grant' | translate }}
                </h2>
                <div class="form-grid">
                  <cdf-form-field
                    [label]="'admin.users.subs.plan' | translate"
                    controlId="grant-plan"
                    [error]="grantErrors()['plan'] ?? null"
                  >
                    <cdf-select
                      inputId="grant-plan"
                      [options]="planOptions()"
                      [placeholder]="'admin.users.subs.pickPlan' | translate"
                      [(ngModel)]="grant.planId"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.users.subs.duration' | translate"
                    [help]="
                      isSupport()
                        ? ('admin.users.subs.supportCap'
                          | translate: { days: maxDays })
                        : null
                    "
                    controlId="grant-days"
                    [error]="grantErrors()['days'] ?? null"
                  >
                    <cdf-input
                      inputId="grant-days"
                      type="number"
                      [(ngModel)]="grant.durationDays"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.common.reason' | translate"
                    [help]="'admin.common.reasonHelp' | translate"
                    controlId="grant-reason"
                  >
                    <cdf-input
                      inputId="grant-reason"
                      [(ngModel)]="grant.reason"
                    />
                  </cdf-form-field>
                </div>
                @if (isSupport() && grant.durationDays > maxDays) {
                  <p class="small warn" role="status">
                    {{
                      'admin.users.subs.overCap' | translate: { days: maxDays }
                    }}
                  </p>
                }
                <div class="form-actions">
                  <cdf-button
                    kind="primary"
                    [loading]="busy() === 'grant'"
                    (click)="grantSubscription()"
                    data-testid="grant-subscription"
                  >
                    {{ 'admin.users.subs.grantButton' | translate }}
                  </cdf-button>
                </div>
                @if (grantError(); as e) {
                  <p class="form-error" role="alert">{{ e }}</p>
                }
              </div>
            </section>
          }
          @case ('enrollments') {
            <section
              id="upanel-enrollments"
              role="tabpanel"
              aria-labelledby="utab-enrollments"
            >
              <div class="admin-card">
                <h2>{{ 'admin.users.enr.title' | translate }}</h2>
                @if (enrollments() === null) {
                  <cdf-skeleton shape="rect" height="80px" />
                } @else if (enrollments()!.length === 0) {
                  <p class="muted small">
                    {{ 'admin.users.enr.none' | translate }}
                  </p>
                } @else {
                  <div class="table-scroll">
                    <table class="admin-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.users.enr.course' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.enr.source' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.enr.until' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.common.createdAt' | translate }}
                          </th>
                          <th scope="col">
                            <span class="visually-hidden">{{
                              'admin.common.actions' | translate
                            }}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (e of enrollments(); track e.id) {
                          <tr [attr.data-enrollment]="e.id">
                            <td>{{ courseTitle(e.courseId) }}</td>
                            <td>
                              {{
                                'admin.users.enr.sources.' + e.source
                                  | translate
                              }}
                            </td>
                            <td class="small">
                              {{
                                e.accessUntil
                                  ? (e.accessUntil | locale: 'datetime')
                                  : ('admin.users.enr.noExpiry' | translate)
                              }}
                            </td>
                            <td class="small">
                              {{ e.createdAt | locale: 'date' }}
                            </td>
                            <td>
                              @if (e.source !== 'SELF') {
                                <cdf-button
                                  kind="ghost"
                                  size="sm"
                                  (click)="revoke(e)"
                                  >{{
                                    'admin.users.enr.revoke' | translate
                                  }}</cdf-button
                                >
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>

              <div class="admin-card" aria-labelledby="grant-enr-title">
                <h2 id="grant-enr-title">
                  {{ 'admin.users.enr.grant' | translate }}
                </h2>
                <div class="form-grid">
                  <cdf-form-field
                    class="span-2"
                    [label]="'admin.users.enr.course' | translate"
                    controlId="enr-course"
                    [error]="enrErrors()['course'] ?? null"
                  >
                    <cdf-combobox
                      inputId="enr-course"
                      [options]="courseOptions()"
                      [placeholder]="'admin.users.enr.searchCourse' | translate"
                      [(ngModel)]="enr.courseId"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.users.enr.source' | translate"
                    controlId="enr-source"
                  >
                    <cdf-select
                      inputId="enr-source"
                      [options]="sourceOptions()"
                      [(ngModel)]="enr.source"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.users.enr.until' | translate"
                    [help]="
                      (isSupport()
                        ? 'admin.users.enr.untilSupport'
                        : 'admin.users.enr.untilHelp'
                      ) | translate: { days: maxDays }
                    "
                    controlId="enr-until"
                    [error]="enrErrors()['until'] ?? null"
                  >
                    <input
                      id="enr-until"
                      type="datetime-local"
                      class="form-control"
                      [(ngModel)]="enr.accessUntil"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.common.reason' | translate"
                    [help]="'admin.common.reasonHelp' | translate"
                    controlId="enr-reason"
                  >
                    <cdf-input inputId="enr-reason" [(ngModel)]="enr.reason" />
                  </cdf-form-field>
                </div>
                <div class="form-actions">
                  <cdf-button
                    kind="primary"
                    [loading]="busy() === 'enroll'"
                    (click)="grantEnrollment()"
                    data-testid="grant-enrollment"
                  >
                    {{ 'admin.users.enr.grantButton' | translate }}
                  </cdf-button>
                </div>
                @if (enrError(); as e) {
                  <p class="form-error" role="alert">{{ e }}</p>
                }
              </div>
            </section>
          }
        }
      } @else if (notFound()) {
        <cdf-empty-state
          icon="user-circle"
          [title]="'admin.users.notFound' | translate"
          [description]="'admin.errors.notFound' | translate"
        >
          <a routerLink="/users">{{ 'admin.users.back' | translate }}</a>
        </cdf-empty-state>
      } @else {
        <cdf-skeleton shape="rect" height="240px" />
      }
    </div>
  `,
  styles: [
    `
      .hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        p {
          margin: 0 0 4px;
        }
      }
      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 16px;
        margin: 0 0 var(--cdf-space-2);
        dt {
          color: var(--cdf-color-text-muted);
        }
        dd {
          margin: 0;
        }
      }
      .span-2 {
        grid-column: span 2;
      }
      @media (max-width: 640px) {
        .span-2 {
          grid-column: 1 / -1;
        }
      }
      .cancel-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 220px;
      }
      .warn {
        color: var(--cdf-color-warning);
      }
    `,
  ],
})
export class UserDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly usersClient = inject(UsersClient);
  private readonly billing = inject(BillingClient);
  private readonly enrollmentsClient = inject(EnrollmentsClient);
  private readonly plansClient = inject(PlansClient);
  private readonly coursesClient = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly tabs: readonly Tab[] = [
    'profile',
    'subscriptions',
    'enrollments',
  ];
  protected readonly tab = signal<Tab>('profile');
  protected readonly maxDays = SUPPORT_MAX_GRANT_DAYS;
  protected readonly isSupport = computed(() => this.auth.role() === 'SUPPORT');
  protected readonly userId = signal('');
  protected readonly user = signal<MeResponse | null>(null);
  protected readonly notFound = signal(false);
  protected readonly subs = signal<AdminSubscriptionView[] | null>(null);
  protected readonly enrollments = signal<EnrollmentView[] | null>(null);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly courses = signal<
    { id: string; title: string; slug: string }[]
  >([]);
  protected readonly busy = signal<string | null>(null);

  protected grant = { planId: '', durationDays: 30, reason: '' };
  protected readonly grantErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected readonly grantError = signal<string | null>(null);
  protected readonly cancelFor = signal<string | null>(null);
  protected cancelMode: 'immediate' | 'period_end' = 'period_end';
  protected cancelReason = '';

  protected enr = {
    courseId: null as string | null,
    source: 'PROMO' as 'PROMO' | 'ADMIN_GRANT',
    accessUntil: '',
    reason: '',
  };
  protected readonly enrErrors = signal<Record<string, string | undefined>>({});
  protected readonly enrError = signal<string | null>(null);

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    return [
      { label: this.i18n.t('admin.nav.users'), routerLink: ['/users'] },
      { label: this.user()?.displayName ?? this.i18n.t('admin.users.user') },
    ];
  });
  protected readonly planOptions = computed<SelectOption<string>[]>(() =>
    this.plans().map((p) => ({ value: p.id, label: p.name })),
  );
  protected readonly courseOptions = computed<ComboboxOption<string>[]>(() =>
    this.courses().map((c) => ({
      value: c.id,
      label: c.title,
      description: c.slug,
    })),
  );
  protected readonly sourceOptions = computed<
    SelectOption<'PROMO' | 'ADMIN_GRANT'>[]
  >(() => {
    this.i18n.currentLocale();
    const all = (['PROMO', 'ADMIN_GRANT'] as const).map((s) => ({
      value: s,
      label: this.i18n.t(`admin.users.enr.sources.${s}`),
    }));
    // docs/14 §2: SUPPORT may only grant PROMO enrollments.
    return this.isSupport() ? all.filter((o) => o.value === 'PROMO') : all;
  });
  protected readonly cancelModeOptions = computed<
    SelectOption<'immediate' | 'period_end'>[]
  >(() => {
    this.i18n.currentLocale();
    return (['period_end', 'immediate'] as const).map((m) => ({
      value: m,
      label: this.i18n.t(`admin.users.subs.modes.${m}`),
    }));
  });

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => p.get('id') ?? ''),
        takeUntilDestroyed(),
      )
      .subscribe((id) => {
        this.userId.set(id);
        void this.load(id);
      });
    void this.loadLookups();
  }

  private async load(id: string): Promise<void> {
    this.user.set(null);
    this.notFound.set(false);
    try {
      this.user.set(await this.usersClient.detail(id));
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isNotFound)
        this.notFound.set(true);
      else this.errorsSvc.toast(err, 'admin.errors.loadFailed');
      return;
    }
    void this.loadSubs();
    void this.loadEnrollments();
  }

  private async loadLookups(): Promise<void> {
    try {
      const [plans, courses] = await Promise.all([
        this.plansClient.list({ includeInactive: true }),
        this.coursesClient.list({ take: 200 }),
      ]);
      this.plans.set(plans.items);
      this.courses.set(
        courses.items.map((c) => ({ id: c.id, title: c.title, slug: c.slug })),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  private async loadSubs(): Promise<void> {
    try {
      this.subs.set(
        (await this.billing.adminUserSubscriptions(this.userId()))
          .subscriptions,
      );
    } catch (err) {
      this.subs.set([]);
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  private async loadEnrollments(): Promise<void> {
    try {
      this.enrollments.set(await this.enrollmentsClient.forUser(this.userId()));
    } catch (err) {
      this.enrollments.set([]);
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected statusVariant(s: SubscriptionStatus): BadgeVariant {
    return STATUS_VARIANT[s] ?? 'neutral';
  }

  protected cancellable(s: AdminSubscriptionView): boolean {
    const store = s.source === 'APPLE_IAP' || s.source === 'GOOGLE_PLAY';
    return (
      !store && s.status !== 'CANCELED' && s.status !== 'INCOMPLETE_EXPIRED'
    );
  }

  protected courseTitle(id: string): string {
    return this.courses().find((c) => c.id === id)?.title ?? id;
  }

  protected async grantSubscription(): Promise<void> {
    const errs: Record<string, string> = {};
    if (!this.grant.planId) errs['plan'] = this.i18n.t('admin.common.required');
    const days = Math.round(Number(this.grant.durationDays));
    if (!Number.isFinite(days) || days < 1)
      errs['days'] = this.i18n.t('admin.common.invalidNumber');
    this.grantErrors.set(errs);
    if (Object.keys(errs).length) return;
    // Over-cap SUPPORT grants are still sent: the API's message explains the rule.
    this.busy.set('grant');
    this.grantError.set(null);
    try {
      const created = await this.billing.adminGrant(this.userId(), {
        planId: this.grant.planId,
        durationDays: days,
        reason: this.grant.reason.trim() || undefined,
      });
      this.subs.update((s) => [created, ...(s ?? [])]);
      this.grant = { planId: '', durationDays: 30, reason: '' };
      this.toast.success(
        this.i18n.t('admin.users.subs.granted', {
          plan: created.planName,
          days,
        }),
      );
    } catch (err) {
      this.grantError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected openCancel(s: AdminSubscriptionView): void {
    this.cancelMode = s.renews ? 'period_end' : 'immediate';
    this.cancelReason = '';
    this.cancelFor.set(s.id);
  }

  protected async cancel(s: AdminSubscriptionView): Promise<void> {
    this.busy.set('cancel');
    try {
      const updated = await this.billing.adminCancel(s.id, {
        mode: this.cancelMode,
        reason: this.cancelReason.trim() || undefined,
      });
      this.subs.update((list) =>
        (list ?? []).map((x) => (x.id === updated.id ? updated : x)),
      );
      this.cancelFor.set(null);
      this.toast.success(
        this.i18n.t(`admin.users.subs.canceled.${this.cancelMode}`),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async grantEnrollment(): Promise<void> {
    const errs: Record<string, string> = {};
    const courseId = this.enr.courseId;
    if (!courseId) errs['course'] = this.i18n.t('admin.common.required');
    const until = this.enr.accessUntil
      ? localToIso(this.enr.accessUntil)
      : null;
    if (this.enr.accessUntil && !until)
      errs['until'] = this.i18n.t('admin.common.invalidNumber');
    if (until && new Date(until).getTime() <= Date.now())
      errs['until'] = this.i18n.t('admin.users.enr.untilPast');
    if (this.isSupport() && !until)
      errs['until'] = this.i18n.t('admin.users.enr.untilRequired');
    this.enrErrors.set(errs);
    if (!courseId || Object.keys(errs).length) return;
    this.busy.set('enroll');
    this.enrError.set(null);
    try {
      const created = await this.enrollmentsClient.grant({
        userId: this.userId(),
        courseId,
        source: this.enr.source,
        ...(until ? { accessUntil: until } : {}),
        reason: this.enr.reason.trim() || undefined,
      });
      this.enrollments.update((list) => [
        created,
        ...(list ?? []).filter((e) => e.id !== created.id),
      ]);
      this.toast.success(
        this.i18n.t('admin.users.enr.granted', {
          course: this.courseTitle(created.courseId),
        }),
      );
      this.enr = {
        courseId: null,
        source: 'PROMO',
        accessUntil: '',
        reason: '',
      };
    } catch (err) {
      this.enrError.set(this.errorsSvc.message(err, 'admin.errors.saveFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async revoke(e: EnrollmentView): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.users.enr.revokeTitle', {
        course: this.courseTitle(e.courseId),
      }),
      message: this.i18n.t('admin.users.enr.revokeMessage'),
      confirmLabel: this.i18n.t('admin.users.enr.revoke'),
      confirmKind: 'danger',
    });
    if (!ok) return;
    try {
      await this.enrollmentsClient.revoke(e.id);
      this.enrollments.update((list) =>
        (list ?? []).filter((x) => x.id !== e.id),
      );
      this.toast.success(this.i18n.t('admin.users.enr.revoked'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    }
  }
}
