import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
  Pagination,
  Skeleton,
  ToastService,
  type CursorPageEvent,
} from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  BillingClient,
  StaffToolsClient,
  type ApiUserRole,
  type GrantAllowance,
  CoursesClient,
  EnrollmentsClient,
  ItemsClient,
  PlansClient,
  ProblemDetailsError,
  UsersClient,
  type LedgerPage,
  type LedgerType,
  type UserInventoryEntry,
  type AdminSubscriptionView,
  type EnrollmentView,
  type MeResponse,
  type BirthDateCorrectionResult,
  type Plan,
  type SubscriptionStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { localToIso } from '../core/catalog';
import { CursorPager } from '../core/cursor-pager';
import { countryName } from '../core/country';
import { LoadError } from '../shared/load-error';
import { UserAccountPanelComponent } from './user-account-panel.component';
import {
  UserAgePanelComponent,
  ageGroupVariant,
} from './user-age-panel.component';
import { UserAuditTab } from './user-audit-tab.component';

type Tab =
  | 'profile'
  | 'subscriptions'
  | 'enrollments'
  | 'inventory'
  | 'ledger'
  | 'account'
  | 'audit';

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
 * an access end, revoke), inventory, ledger, account and the audit trail
 * (STF-8). Every mutation carries an audit reason; cancelling, revoking,
 * role changes and grants ask for the user's email typed back (SEC-8).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    UserAccountPanelComponent,
    UserAgePanelComponent,
    UserAuditTab,
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
    LoadError,
    Pagination,
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
              (click)="openTab(t)"
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
                  <dt>{{ 'admin.users.country' | translate }}</dt>
                  <dd data-testid="user-country">
                    @if (countryLabel(u.country); as name) {
                      {{ name }} <span class="muted">({{ u.country }})</span>
                    } @else {
                      {{ 'admin.users.countryUnknown' | translate }}
                    }
                    <div class="muted small">
                      {{ 'admin.users.countryHelp' | translate }}
                    </div>
                  </dd>
                  <dt>{{ 'admin.users.ageGroup' | translate }}</dt>
                  <dd data-testid="user-age-group">
                    <cdf-badge [variant]="ageVariant(u.ageGroup ?? null)">{{
                      'admin.users.ageGroups.' + (u.ageGroup ?? 'none')
                        | translate
                    }}</cdf-badge>
                  </dd>
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
              @if (isAdmin() && !isSelf()) {
                <div
                  class="admin-card"
                  aria-labelledby="role-title"
                  data-testid="role-change"
                >
                  <h2 id="role-title">
                    {{ 'admin.staff.role.title' | translate }}
                  </h2>
                  <div class="form-grid">
                    <cdf-form-field
                      [label]="'admin.staff.role.newRole' | translate"
                      controlId="role-select"
                    >
                      <cdf-select
                        inputId="role-select"
                        [options]="roleOptions()"
                        [(ngModel)]="roleDraft"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.common.reason' | translate"
                      [help]="'admin.common.reasonHelp' | translate"
                      controlId="role-reason"
                    >
                      <cdf-input
                        inputId="role-reason"
                        [(ngModel)]="roleReason"
                      />
                    </cdf-form-field>
                  </div>
                  <div class="form-actions">
                    <cdf-button
                      kind="danger"
                      [disabled]="roleDraft === u.role"
                      [loading]="busy() === 'role'"
                      (click)="changeRole()"
                      data-testid="change-role"
                    >
                      {{ 'admin.staff.role.change' | translate }}
                    </cdf-button>
                  </div>
                </div>
              }
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
          @case ('inventory') {
            <section
              id="upanel-inventory"
              role="tabpanel"
              aria-labelledby="utab-inventory"
            >
              <div class="admin-card">
                <h2>{{ 'admin.users.inv.title' | translate }}</h2>
                @if (invError(); as e) {
                  <cdf-load-error [message]="e" (retry)="loadInventory()" />
                } @else if (inventory() === null) {
                  <cdf-skeleton shape="rect" height="80px" />
                } @else if (inventory()!.length === 0) {
                  <p class="muted small">
                    {{ 'admin.users.inv.none' | translate }}
                  </p>
                } @else {
                  <div class="table-scroll">
                    <table class="admin-table" data-testid="user-inventory">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.users.inv.item' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.inv.slot' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.inv.source' | translate }}
                          </th>
                          <th scope="col">
                            {{ 'admin.users.inv.acquired' | translate }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (i of inventory(); track i.itemId) {
                          <tr>
                            <td>
                              <strong>{{ i.name }}</strong>
                              <div class="mono muted">{{ i.slug }}</div>
                              @if (i.equipped) {
                                <cdf-badge variant="success" [subtle]="true">{{
                                  'admin.users.inv.equipped' | translate
                                }}</cdf-badge>
                              }
                            </td>
                            <td>
                              {{ 'admin.items.slots.' + i.slot | translate }}
                              <div class="muted small">
                                {{
                                  'admin.items.rarities.' + i.rarity | translate
                                }}
                              </div>
                            </td>
                            <td>
                              <cdf-badge variant="neutral" [subtle]="true">{{
                                'admin.users.inv.sources.' + i.source
                                  | translate
                              }}</cdf-badge>
                            </td>
                            <td class="small">
                              {{ i.acquiredAt | locale: 'datetime' }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>

              @if (isAdmin()) {
                <div class="admin-card" aria-labelledby="grant-item-title">
                  <h2 id="grant-item-title">
                    {{ 'admin.users.inv.grant' | translate }}
                  </h2>
                  <div class="form-grid">
                    <cdf-form-field
                      class="span-2"
                      [label]="'admin.users.inv.item' | translate"
                      controlId="grant-item"
                      [error]="itemErrors()['item'] ?? null"
                    >
                      <cdf-combobox
                        inputId="grant-item"
                        [options]="itemOptions()"
                        [placeholder]="'admin.users.inv.searchItem' | translate"
                        [(ngModel)]="itemGrant.itemId"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      class="span-all"
                      [label]="'admin.users.inv.reason' | translate"
                      [help]="'admin.common.reasonHelp' | translate"
                      controlId="grant-item-reason"
                      [error]="itemErrors()['reason'] ?? null"
                    >
                      <cdf-input
                        inputId="grant-item-reason"
                        [(ngModel)]="itemGrant.reason"
                      />
                    </cdf-form-field>
                  </div>
                  <div class="form-actions">
                    <cdf-button
                      kind="primary"
                      [loading]="busy() === 'item'"
                      (click)="grantItem()"
                      data-testid="grant-item"
                    >
                      {{ 'admin.users.inv.grantButton' | translate }}
                    </cdf-button>
                  </div>
                  @if (itemError(); as e) {
                    <p class="form-error" role="alert">{{ e }}</p>
                  }
                </div>
              }
            </section>
          }
          @case ('ledger') {
            <section
              id="upanel-ledger"
              role="tabpanel"
              aria-labelledby="utab-ledger"
            >
              <div
                class="admin-card"
                aria-labelledby="grant-title"
                data-testid="grant-form"
              >
                <h2 id="grant-title">
                  {{ 'admin.staff.grant.title' | translate }}
                </h2>
                @if (allowance(); as al) {
                  <p class="muted small" data-testid="grant-allowance">
                    {{
                      'admin.staff.grant.allowance'
                        | translate
                          : {
                              used: al.usedToday.coins,
                              limit: al.limit.coins,
                            }
                    }}
                    @if (al.maxCoinsPerGrant !== null) {
                      ·
                      {{
                        'admin.staff.grant.perGrantCap'
                          | translate: { cap: al.maxCoinsPerGrant }
                      }}
                    }
                  </p>
                }
                <div class="form-grid">
                  <cdf-form-field
                    [label]="'admin.staff.grant.coins' | translate"
                    controlId="grant-coins"
                    [error]="grantFormErrors()['coins'] ?? null"
                  >
                    <cdf-input
                      inputId="grant-coins"
                      type="number"
                      [(ngModel)]="coinGrant.coins"
                    />
                  </cdf-form-field>
                  @if (isAdmin()) {
                    <cdf-form-field
                      [label]="'admin.staff.grant.xp' | translate"
                      controlId="grant-xp"
                      [error]="grantFormErrors()['xp'] ?? null"
                    >
                      <cdf-input
                        inputId="grant-xp"
                        type="number"
                        [(ngModel)]="coinGrant.xp"
                      />
                    </cdf-form-field>
                  }
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.common.reason' | translate"
                    [help]="'admin.common.reasonHelp' | translate"
                    controlId="grant-coin-reason"
                    [error]="grantFormErrors()['reason'] ?? null"
                  >
                    <cdf-input
                      inputId="grant-coin-reason"
                      [(ngModel)]="coinGrant.reason"
                    />
                  </cdf-form-field>
                </div>
                <div class="form-actions">
                  <cdf-button
                    kind="primary"
                    [loading]="busy() === 'coins'"
                    (click)="grantCoins()"
                    data-testid="grant-coins"
                  >
                    {{ 'admin.staff.grant.submit' | translate }}
                  </cdf-button>
                </div>
                @if (coinGrantError(); as e) {
                  <p class="form-error" role="alert">{{ e }}</p>
                }
              </div>
              <div class="admin-card">
                <header class="section-head">
                  <h2>{{ 'admin.users.ledger.title' | translate }}</h2>
                  <div
                    class="seg"
                    role="group"
                    [attr.aria-label]="'admin.users.ledger.type' | translate"
                  >
                    @for (lt of ledgerTypes; track lt) {
                      <button
                        type="button"
                        class="btn btn-sm"
                        [class.btn-primary]="ledgerType() === lt"
                        [class.btn-outline-primary]="ledgerType() !== lt"
                        [attr.aria-pressed]="ledgerType() === lt"
                        [attr.data-ledger-type]="lt"
                        (click)="setLedgerType(lt)"
                      >
                        {{ 'admin.users.ledger.types.' + lt | translate }}
                      </button>
                    }
                  </div>
                </header>
                @if (ledgerError(); as e) {
                  <cdf-load-error [message]="e" (retry)="reloadLedger()" />
                } @else if (ledger() === null) {
                  <cdf-skeleton shape="rect" height="120px" />
                } @else {
                  <p class="small" aria-live="polite">
                    {{
                      'admin.users.ledger.balance.' + ledger()!.type
                        | translate: { value: ledger()!.balance }
                    }}
                  </p>
                  @if (ledger()!.items.length === 0) {
                    <p class="muted small">
                      {{ 'admin.users.ledger.none' | translate }}
                    </p>
                  } @else {
                    <div class="table-scroll">
                      <table class="admin-table" data-testid="user-ledger">
                        <thead>
                          <tr>
                            <th scope="col">
                              {{ 'admin.users.ledger.when' | translate }}
                            </th>
                            <th scope="col">
                              {{ 'admin.users.ledger.source' | translate }}
                            </th>
                            <th scope="col" class="num">
                              {{ 'admin.users.ledger.delta' | translate }}
                            </th>
                            <th scope="col" class="num">
                              {{
                                'admin.users.ledger.balanceAfter' | translate
                              }}
                            </th>
                            <th scope="col">
                              {{ 'admin.users.ledger.ref' | translate }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (r of ledger()!.items; track r.id) {
                            <tr>
                              <td class="small">
                                {{ r.createdAt | locale: 'datetime' }}
                              </td>
                              <td class="mono">{{ r.source }}</td>
                              <td
                                class="num"
                                [class.pos]="r.delta > 0"
                                [class.neg]="r.delta < 0"
                              >
                                {{ r.delta > 0 ? '+' : ''
                                }}{{ r.delta | locale: 'integer' }}
                                @if (r.multiplier && r.multiplier !== '1') {
                                  <span class="muted small"
                                    >×{{ r.multiplier }}</span
                                  >
                                }
                              </td>
                              <td class="num">
                                {{ r.balanceAfter | locale: 'integer' }}
                              </td>
                              <td class="mono muted">
                                {{ r.refType }} {{ r.refId }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <cdf-pagination
                      mode="cursor"
                      [prevCursor]="null"
                      [canGoBack]="ledgerPager.canGoBack"
                      [nextCursor]="ledger()!.nextCursor"
                      [pageLabel]="
                        'admin.audit.page' | translate: { page: ledgerPage() }
                      "
                      (cursorChange)="onLedgerPage($event)"
                    />
                  }
                }
              </div>
            </section>
          }
          @case ('account') {
            <section
              id="upanel-account"
              role="tabpanel"
              aria-labelledby="utab-account"
            >
              <!-- docs/14 "Minors": age group + staff date correction. -->
              <cdf-user-age-panel
                [userId]="userId()"
                [email]="u.email"
                [ageGroup]="u.ageGroup ?? null"
                (corrected)="onAgeCorrected($event)"
              />
              <cdf-user-account-panel [userId]="userId()" [email]="u.email" />
            </section>
          }
          @case ('audit') {
            <section
              id="upanel-audit"
              role="tabpanel"
              aria-labelledby="utab-audit"
            >
              <cdf-user-audit-tab
                [userId]="userId()"
                [staff]="u.role !== 'STUDENT'"
              />
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
      .seg {
        display: inline-flex;
        gap: 4px;
      }
      .pos {
        color: var(--cdf-color-success);
      }
      .neg {
        color: var(--cdf-color-danger);
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
  private readonly adminOps = inject(AdminOpsClient);
  private readonly itemsClient = inject(ItemsClient);
  private readonly staffTools = inject(StaffToolsClient);

  protected readonly tabs: readonly Tab[] = [
    'profile',
    'subscriptions',
    'enrollments',
    'inventory',
    'ledger',
    'account',
    'audit',
  ];
  protected readonly isAdmin = computed(() => this.auth.role() === 'ADMIN');
  /** Staff can't change their own role (403 ROLE_CHANGE_SELF). */
  protected readonly isSelf = computed(() => {
    const me = this.auth.user();
    const u = this.user();
    return !!me && (me.id === this.userId() || (!!u && me.email === u.email));
  });
  protected roleDraft: ApiUserRole = 'STUDENT';
  protected roleReason = '';
  protected readonly roleOptions = computed<SelectOption<ApiUserRole>[]>(() => {
    this.i18n.currentLocale();
    return (['STUDENT', 'TEACHER', 'SUPPORT', 'ADMIN'] as const).map((r) => ({
      value: r,
      label: this.i18n.t(`admin.roles.${r}`),
    }));
  });
  protected coinGrant = {
    coins: null as number | null,
    xp: null as number | null,
    reason: '',
  };
  protected readonly grantFormErrors = signal<
    Record<string, string | undefined>
  >({});
  protected readonly coinGrantError = signal<string | null>(null);
  protected readonly allowance = signal<GrantAllowance | null>(null);
  protected readonly inventory = signal<UserInventoryEntry[] | null>(null);
  protected readonly invError = signal<string | null>(null);
  protected readonly items = signal<
    { id: string; name: string; slug: string }[]
  >([]);
  protected readonly itemOptions = computed<ComboboxOption<string>[]>(() =>
    this.items().map((i) => ({
      value: i.id,
      label: i.name,
      description: i.slug,
    })),
  );
  protected itemGrant = { itemId: null as string | null, reason: '' };
  protected readonly itemErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected readonly itemError = signal<string | null>(null);
  protected readonly ledgerTypes: readonly LedgerType[] = ['coins', 'xp'];
  protected readonly ledgerType = signal<LedgerType>('coins');
  protected readonly ledger = signal<LedgerPage | null>(null);
  protected readonly ledgerError = signal<string | null>(null);
  protected readonly ledgerPage = signal(1);
  protected readonly ledgerPager = new CursorPager();
  private ledgerSeq = 0;
  private readonly loadedTabs = new Set<Tab>();
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
    this.loadedTabs.clear();
    this.inventory.set(null);
    this.ledger.set(null);
    this.ledgerPager.reset();
    try {
      const detail = await this.usersClient.detail(id);
      this.user.set(detail);
      this.roleDraft = detail.role;
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isNotFound)
        this.notFound.set(true);
      else this.errorsSvc.toast(err, 'admin.errors.loadFailed');
      return;
    }
    void this.loadSubs();
    void this.loadEnrollments();
    this.openTab(this.tab());
  }

  /** Select a tab; inventory and ledger load on first open. */
  protected openTab(t: Tab): void {
    this.tab.set(t);
    if (!this.user() || this.loadedTabs.has(t)) return;
    if (t === 'inventory') {
      this.loadedTabs.add(t);
      void this.loadInventory();
      if (this.isAdmin() && this.items().length === 0) void this.loadItems();
    } else if (t === 'ledger') {
      this.loadedTabs.add(t);
      void this.loadLedger(undefined);
      void this.loadAllowance();
    }
  }

  protected async loadInventory(): Promise<void> {
    this.invError.set(null);
    this.inventory.set(null);
    try {
      this.inventory.set(await this.adminOps.userItems(this.userId()));
    } catch (err) {
      this.invError.set(this.errorsSvc.message(err, 'admin.errors.loadFailed'));
    }
  }

  private async loadItems(): Promise<void> {
    try {
      const all = await this.itemsClient.listItems();
      this.items.set(
        all.map((i) => ({ id: i.id, name: i.name, slug: i.slug })),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async grantItem(): Promise<void> {
    const errs: Record<string, string> = {};
    const itemId = this.itemGrant.itemId;
    const reason = this.itemGrant.reason.trim();
    if (!itemId) errs['item'] = this.i18n.t('admin.common.required');
    if (reason.length < 3)
      errs['reason'] = this.i18n.t('admin.users.inv.reasonRequired');
    this.itemErrors.set(errs);
    if (!itemId || Object.keys(errs).length) return;
    this.busy.set('item');
    this.itemError.set(null);
    try {
      const res = await this.adminOps.grantItem(this.userId(), {
        itemId,
        reason,
      });
      if (res.alreadyOwned) {
        this.toast.info(
          this.i18n.t('admin.users.inv.alreadyOwned', { item: res.entry.name }),
        );
      } else {
        this.inventory.update((list) => [
          res.entry,
          ...(list ?? []).filter((i) => i.itemId !== res.entry.itemId),
        ]);
        this.toast.success(
          this.i18n.t('admin.users.inv.granted', { item: res.entry.name }),
        );
      }
      this.itemGrant = { itemId: null, reason: '' };
    } catch (err) {
      this.itemError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  private async loadAllowance(): Promise<void> {
    try {
      this.allowance.set(await this.staffTools.grantAllowance());
    } catch {
      this.allowance.set(null);
    }
  }

  /**
   * docs/14 §18: destructive / money actions on a user ask for the user's
   * email typed back before they run.
   */
  protected typedConfirm(
    titleKey: string,
    messageKey: string,
    confirmKey: string,
    params: Record<string, unknown> = {},
  ): Promise<boolean | null> {
    const u = this.user();
    return this.confirm.open({
      title: this.i18n.t(titleKey, params),
      message: this.i18n.t(messageKey, params),
      confirmLabel: this.i18n.t(confirmKey),
      confirmKind: 'danger',
      ...(u ? { typeToConfirm: u.email } : {}),
    });
  }

  /** Manual coin / XP grant (docs/04 Users; SUPPORT ≤ 1,000 coins, no XP). */
  protected async grantCoins(): Promise<void> {
    const errs: Record<string, string> = {};
    const coins = Math.round(Number(this.coinGrant.coins ?? 0));
    const xp = this.isAdmin() ? Math.round(Number(this.coinGrant.xp ?? 0)) : 0;
    const reason = this.coinGrant.reason.trim();
    if (!Number.isFinite(coins) || coins < 0)
      errs['coins'] = this.i18n.t('admin.common.invalidNumber');
    if (!Number.isFinite(xp) || xp < 0)
      errs['xp'] = this.i18n.t('admin.common.invalidNumber');
    if (!errs['coins'] && !errs['xp'] && coins === 0 && xp === 0)
      errs['coins'] = this.i18n.t('admin.staff.grant.empty');
    const cap = this.allowance()?.maxCoinsPerGrant ?? null;
    if (cap !== null && coins > cap)
      errs['coins'] = this.i18n.t('admin.staff.grant.overCap', { cap });
    if (reason.length < 3)
      errs['reason'] = this.i18n.t('admin.users.inv.reasonRequired');
    this.grantFormErrors.set(errs);
    if (Object.keys(errs).length) return;
    const ok = await this.typedConfirm(
      'admin.staff.grant.confirmTitle',
      'admin.staff.grant.confirmMessage',
      'admin.staff.grant.submit',
      { coins, xp, name: this.user()?.displayName ?? '' },
    );
    if (!ok) return;
    this.busy.set('coins');
    this.coinGrantError.set(null);
    try {
      const res = await this.staffTools.grant(this.userId(), {
        ...(coins > 0 ? { coins } : {}),
        ...(xp > 0 ? { xp } : {}),
        reason,
      });
      this.user.update((u) =>
        u ? { ...u, coins: res.after.coins, totalXp: res.after.totalXp } : u,
      );
      this.allowance.update((a) =>
        a
          ? {
              ...a,
              usedToday: {
                coins: a.usedToday.coins + res.coins,
                xp: a.usedToday.xp + res.xp,
              },
            }
          : a,
      );
      this.coinGrant = { coins: null, xp: null, reason: '' };
      this.toast.success(
        this.i18n.t('admin.staff.grant.done', { coins: res.coins, xp: res.xp }),
      );
      this.ledgerPager.reset();
      void this.loadLedger(undefined);
    } catch (err) {
      this.coinGrantError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  /** Role change (docs/14 §11; ADMIN, never your own account). */
  protected async changeRole(): Promise<void> {
    const u = this.user();
    if (!u || this.roleDraft === u.role) return;
    const role = this.roleDraft;
    const ok = await this.typedConfirm(
      'admin.staff.role.confirmTitle',
      'admin.staff.role.confirmMessage',
      'admin.staff.role.change',
      {
        name: u.displayName,
        from: this.i18n.t(`admin.roles.${u.role}`),
        to: this.i18n.t(`admin.roles.${role}`),
      },
    );
    if (!ok) return;
    this.busy.set('role');
    try {
      const res = await this.staffTools.changeRole(
        u.id,
        role,
        this.roleReason.trim() || undefined,
      );
      this.user.update((x) => (x ? { ...x, role: res.role } : x));
      this.roleDraft = res.role;
      this.roleReason = '';
      this.toast.success(
        this.i18n.t('admin.staff.role.changed', {
          role: this.i18n.t(`admin.roles.${res.role}`),
        }),
      );
    } catch (err) {
      this.roleDraft = u.role;
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected setLedgerType(t: LedgerType): void {
    if (this.ledgerType() === t) return;
    this.ledgerType.set(t);
    this.ledgerPager.reset();
    void this.loadLedger(undefined);
  }

  protected reloadLedger(): void {
    void this.loadLedger(this.ledgerPager.current);
  }

  protected onLedgerPage(ev: CursorPageEvent): void {
    const cursor =
      ev.direction === 'next' && ev.cursor
        ? this.ledgerPager.forward(ev.cursor)
        : this.ledgerPager.back();
    void this.loadLedger(cursor);
  }

  private async loadLedger(cursor: string | undefined): Promise<void> {
    const seq = ++this.ledgerSeq;
    this.ledgerError.set(null);
    this.ledger.set(null);
    try {
      const page = await this.adminOps.ledger(this.userId(), {
        type: this.ledgerType(),
        ...(cursor ? { cursor } : {}),
        limit: 25,
      });
      if (seq !== this.ledgerSeq) return;
      this.ledger.set(page);
      this.ledgerPage.set(this.ledgerPager.page);
    } catch (err) {
      if (seq === this.ledgerSeq)
        this.ledgerError.set(
          this.errorsSvc.message(err, 'admin.errors.loadFailed'),
        );
    }
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

  protected readonly ageVariant = ageGroupVariant;
  private readonly router = inject(Router);

  /** Corrected date of birth: new age group, or gone (under 12). */
  protected onAgeCorrected(res: BirthDateCorrectionResult): void {
    if ('deleted' in res.after) {
      void this.router.navigateByUrl('/users');
      return;
    }
    const ageGroup = res.after.ageGroup;
    this.user.update((u) => (u ? { ...u, ageGroup } : u));
  }

  /** IP-derived country (CF-IPCountry) in the admin's locale. */
  protected countryLabel(code: string | null | undefined): string | null {
    return countryName(code, this.i18n.currentLocale());
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
    const mode = this.cancelMode;
    const ok = await this.typedConfirm(
      'admin.users.subs.cancelTitle',
      `admin.users.subs.cancelMessage.${mode}`,
      'admin.users.subs.confirmCancel',
      { plan: s.planName, name: this.user()?.displayName ?? '' },
    );
    if (!ok) return;
    this.busy.set('cancel');
    try {
      const updated = await this.billing.adminCancel(s.id, {
        mode,
        reason: this.cancelReason.trim() || undefined,
      });
      this.subs.update((list) =>
        (list ?? []).map((x) => (x.id === updated.id ? updated : x)),
      );
      this.cancelFor.set(null);
      this.toast.success(this.i18n.t(`admin.users.subs.canceled.${mode}`));
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
    const ok = await this.typedConfirm(
      'admin.users.enr.revokeTitle',
      'admin.users.enr.revokeMessage',
      'admin.users.enr.revoke',
      { course: this.courseTitle(e.courseId) },
    );
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
