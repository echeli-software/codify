import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@codify/auth';
import {
  I18nService,
  LocalePipe,
  TranslatePipe,
  formatForLocale,
} from '@codify/i18n';
import {
  Badge,
  Button,
  ConfirmDialogService,
  FormField,
  Icon,
  Input,
  Skeleton,
  Textarea,
  ToastService,
  type BadgeVariant,
} from '@codify/ui-bootstrap';
import {
  AccountClient,
  BillingClient,
  type AdminAccountStatusView,
  type AdminPaymentView,
  type PaymentStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';

const PAGE = 10;

const PAYMENT_VARIANT: Record<PaymentStatus, BadgeVariant> = {
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'warning',
};

const PAYMENT_STATUS_KEY: Record<PaymentStatus, string> = {
  PAID: 'admin.account.payments.statusPaid',
  FAILED: 'admin.account.payments.statusFailed',
  REFUNDED: 'admin.account.payments.statusRefunded',
  PARTIALLY_REFUNDED: 'admin.account.payments.statusPartiallyRefunded',
};

const ACCOUNT_STATUS_KEY = {
  active: 'admin.account.statusActive',
  deleted: 'admin.account.statusDeleted',
  suspended: 'admin.account.statusSuspended',
} as const;

/** Reason length the API accepts (SuspendUserDto). */
export const SUSPEND_REASON_MIN = 3;
export const SUSPEND_REASON_MAX = 500;

/**
 * Users → detail: account lifecycle + payments (docs/04 Users "Suspend /
 * unsuspend", docs/09 billing history). ADMIN and SUPPORT; the API limits
 * SUPPORT to student/teacher accounts and audits every change
 * (`user.suspended` / `user.unsuspended`).
 *
 *   <cdf-user-account-panel [userId]="id" />
 */
@Component({
  selector: 'cdf-user-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    FormField,
    Icon,
    Input,
    LoadError,
    Skeleton,
    Textarea,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <section
      class="admin-card"
      aria-labelledby="acct-title"
      data-testid="user-account-panel"
    >
      <h2 id="acct-title">{{ 'admin.account.title' | translate }}</h2>
      @if (statusError(); as e) {
        <cdf-load-error [message]="e" (retry)="loadStatus()" />
      } @else if (status(); as s) {
        <dl class="kv">
          <dt>{{ 'admin.common.status' | translate }}</dt>
          <dd>
            <cdf-badge
              [variant]="
                s.status === 'active'
                  ? 'success'
                  : s.status === 'suspended'
                    ? 'danger'
                    : 'warning'
              "
              data-testid="account-status"
              >{{ statusKey(s) | translate }}</cdf-badge
            >
          </dd>
          @if (s.suspendedAt) {
            <dt>{{ 'admin.account.suspendedAt' | translate }}</dt>
            <dd>{{ s.suspendedAt | locale: 'datetime' }}</dd>
            <dt>{{ 'admin.account.reason' | translate }}</dt>
            <dd class="reason">{{ s.suspendedReason }}</dd>
          }
          @if (s.deletedAt) {
            <dt>{{ 'admin.account.deletedAt' | translate }}</dt>
            <dd>
              {{ s.deletedAt | locale: 'datetime' }}
              <span class="muted small">{{
                (s.deletionRequestedAt
                  ? 'admin.account.deletedBySelf'
                  : 'admin.account.deletedByProvider'
                ) | translate
              }}</span>
            </dd>
            @if (s.restorableUntil) {
              <dt>{{ 'admin.account.restorableUntil' | translate }}</dt>
              <dd>{{ s.restorableUntil | locale: 'datetime' }}</dd>
            }
            @if (s.purgedAt) {
              <dt>{{ 'admin.account.purgedAt' | translate }}</dt>
              <dd>{{ s.purgedAt | locale: 'datetime' }}</dd>
            } @else if (s.purgeAt) {
              <dt>{{ 'admin.account.purgeAt' | translate }}</dt>
              <dd>{{ s.purgeAt | locale: 'datetime' }}</dd>
            }
          }
        </dl>

        @if (!s.purgedAt) {
          @if (s.suspendedAt) {
            <cdf-button
              kind="secondary"
              [loading]="busy()"
              (click)="unsuspend()"
              data-testid="unsuspend"
            >
              {{ 'admin.account.unsuspend' | translate }}
            </cdf-button>
          } @else {
            <form
              class="suspend"
              (submit)="suspend($event)"
              data-testid="suspend-form"
            >
              <cdf-form-field
                [label]="'admin.account.reasonLabel' | translate"
                [help]="'admin.account.reasonHelp' | translate"
                [error]="reasonError()"
              >
                <cdf-textarea
                  name="reason"
                  [rows]="2"
                  [maxLength]="reasonMax"
                  [(ngModel)]="reason"
                />
              </cdf-form-field>
              <cdf-button
                kind="danger"
                type="submit"
                [loading]="busy()"
                data-testid="suspend"
              >
                <cdf-icon name="lock" size="sm" />
                {{ 'admin.account.suspend' | translate }}
              </cdf-button>
            </form>
          }
        }
      } @else {
        <cdf-skeleton shape="rect" height="96px" />
      }

      <h3>{{ 'admin.account.payments.title' | translate }}</h3>
      @if (paymentsError(); as e) {
        <cdf-load-error [message]="e" (retry)="loadPayments()" />
      } @else if (payments() === null) {
        <cdf-skeleton shape="rect" height="96px" />
      } @else if (payments()!.length === 0) {
        <p class="muted" data-testid="payments-empty">
          {{ 'admin.account.payments.empty' | translate }}
        </p>
      } @else {
        <div class="table-scroll">
          <table class="admin-table" data-testid="payments-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.account.payments.date' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.account.payments.amount' | translate }}
                </th>
                <th scope="col">{{ 'admin.common.status' | translate }}</th>
                <th scope="col">
                  {{ 'admin.account.payments.method' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.account.payments.reference' | translate }}
                </th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.account.payments.receipt' | translate
                  }}</span>
                </th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.common.actions' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (p of payments(); track p.id) {
                <tr data-testid="payment-row">
                  <td class="small">
                    {{ p.paidAt ?? p.createdAt | locale: 'date' }}
                  </td>
                  <td class="num">
                    {{ p.amountCents | locale: 'currency' : p.currency }}
                    @if (p.refundedCents > 0) {
                      <div class="muted small">
                        {{
                          'admin.account.payments.refunded'
                            | translate
                              : {
                                  amount:
                                    (p.refundedCents
                                    | locale: 'currency' : p.currency),
                                }
                        }}
                      </div>
                    }
                  </td>
                  <td>
                    <cdf-badge [variant]="paymentVariant(p)">{{
                      paymentStatusKey(p) | translate
                    }}</cdf-badge>
                  </td>
                  <td class="small">
                    {{ p.provider }} · {{ p.method ?? '—' }}
                  </td>
                  <td class="mono small">{{ p.externalId }}</td>
                  <td>
                    @if (p.receiptUrl) {
                      <a
                        [href]="p.receiptUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ 'admin.account.payments.receipt' | translate }}</a
                      >
                    }
                  </td>
                  <td>
                    @if (p.provider !== 'STRIPE') {
                      <span class="muted small" data-testid="store-refund">{{
                        'admin.staff.refund.storeManaged' | translate
                      }}</span>
                    } @else if (refundable(p)) {
                      <cdf-button
                        kind="secondary"
                        size="sm"
                        (click)="openRefund(p)"
                        [attr.data-refund]="p.id"
                        >{{
                          'admin.staff.refund.action' | translate
                        }}</cdf-button
                      >
                    }
                  </td>
                </tr>
                @if (refundFor() === p.id) {
                  <tr class="refund-row">
                    <td colspan="7">
                      <form
                        class="refund"
                        (submit)="refund($event, p)"
                        data-testid="refund-form"
                      >
                        <cdf-form-field
                          [label]="
                            'admin.staff.refund.amount'
                              | translate: { currency: p.currency }
                          "
                          [help]="refundHelp(p)"
                          [error]="refundErrors()['amount'] ?? null"
                        >
                          <cdf-input
                            name="refundAmount"
                            type="number"
                            [(ngModel)]="refundAmount"
                          />
                        </cdf-form-field>
                        <cdf-form-field
                          [label]="'admin.common.reason' | translate"
                          [help]="'admin.common.reasonHelp' | translate"
                          [error]="refundErrors()['reason'] ?? null"
                        >
                          <cdf-input
                            name="refundReason"
                            [(ngModel)]="refundReason"
                          />
                        </cdf-form-field>
                        <div class="refund__actions">
                          <cdf-button
                            kind="danger"
                            type="submit"
                            [loading]="busy()"
                            data-testid="refund-submit"
                            >{{
                              'admin.staff.refund.submit' | translate
                            }}</cdf-button
                          >
                          <cdf-button
                            kind="ghost"
                            (click)="refundFor.set(null)"
                            >{{ 'admin.common.close' | translate }}</cdf-button
                          >
                        </div>
                      </form>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        @if (payments()!.length < paymentsTotal()) {
          <cdf-button
            kind="ghost"
            size="sm"
            [loading]="loadingMore()"
            (click)="morePayments()"
            >{{ 'admin.account.payments.more' | translate }}</cdf-button
          >
        }
      }
    </section>
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
      h2 {
        font-size: 1.125rem;
        margin: 0 0 var(--cdf-space-3);
      }
      h3 {
        font-size: 1rem;
        margin: var(--cdf-space-4) 0 var(--cdf-space-2);
      }
      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--cdf-space-2) var(--cdf-space-3);
        margin: 0 0 var(--cdf-space-3);
      }
      .kv dt {
        font-weight: 600;
      }
      .kv dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .reason {
        white-space: pre-wrap;
      }
      .suspend {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--cdf-space-2);
        max-width: 560px;
      }
      .suspend cdf-form-field {
        align-self: stretch;
      }
      .refund {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
      .refund cdf-form-field {
        flex: 1 1 200px;
      }
      .refund__actions {
        display: flex;
        gap: var(--cdf-space-2);
      }
      @media (max-width: 575px) {
        .kv {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class UserAccountPanelComponent {
  readonly userId = input.required<string>();
  /** The user's email — typed back to confirm destructive actions (docs/14 §18). */
  readonly email = input<string | null>(null);

  private readonly account = inject(AccountClient);
  private readonly billing = inject(BillingClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);

  /** docs/14 §2: SUPPORT refunds ≤ one month (the API enforces the cap). */
  protected readonly isSupport = computed(() => this.auth.role() === 'SUPPORT');
  protected readonly refundFor = signal<string | null>(null);
  protected readonly refundErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected refundAmount: number | null = null;
  protected refundReason = '';

  protected readonly status = signal<AdminAccountStatusView | null>(null);
  protected readonly statusError = signal<string | null>(null);
  protected readonly payments = signal<AdminPaymentView[] | null>(null);
  protected readonly paymentsTotal = signal(0);
  protected readonly paymentsError = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly busy = signal(false);
  protected readonly reasonError = signal<string | null>(null);
  protected readonly reasonMax = SUSPEND_REASON_MAX;
  protected reason = '';

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this.status.set(null);
        this.payments.set(null);
        this.reason = '';
        void this.loadStatus(id);
        void this.loadPayments(id);
      });
    });
  }

  protected statusKey(s: AdminAccountStatusView): string {
    return ACCOUNT_STATUS_KEY[s.status];
  }

  protected paymentVariant(p: AdminPaymentView): BadgeVariant {
    return PAYMENT_VARIANT[p.status] ?? 'neutral';
  }

  protected paymentStatusKey(p: AdminPaymentView): string {
    return PAYMENT_STATUS_KEY[p.status] ?? 'admin.common.unknown';
  }

  protected async loadStatus(id = this.userId()): Promise<void> {
    this.statusError.set(null);
    try {
      this.status.set(await this.account.adminStatus(id));
    } catch (err) {
      this.statusError.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  protected async loadPayments(id = this.userId()): Promise<void> {
    this.paymentsError.set(null);
    try {
      const page = await this.billing.adminUserPayments(id, {
        skip: 0,
        take: PAGE,
      });
      this.payments.set(page.items);
      this.paymentsTotal.set(page.total);
    } catch (err) {
      this.paymentsError.set(
        this.errors.message(err, 'admin.errors.loadFailed'),
      );
    }
  }

  protected async morePayments(): Promise<void> {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.billing.adminUserPayments(this.userId(), {
        skip: this.payments()?.length ?? 0,
        take: PAGE,
      });
      this.payments.update((list) => [...(list ?? []), ...page.items]);
      this.paymentsTotal.set(page.total);
    } catch (err) {
      this.errors.toast(err, 'admin.errors.loadFailed');
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected async suspend(ev: Event): Promise<void> {
    ev.preventDefault();
    const reason = this.reason.trim();
    if (reason.length < SUSPEND_REASON_MIN) {
      this.reasonError.set(this.i18n.t('admin.account.reasonRequired'));
      return;
    }
    this.reasonError.set(null);
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.account.suspendConfirmTitle'),
      message: this.i18n.t('admin.account.suspendConfirmMessage'),
      confirmLabel: this.i18n.t('admin.account.suspend'),
      confirmKind: 'danger',
      ...this.typed(),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.account.suspend(this.userId(), reason);
      this.status.set(res);
      this.reason = '';
      this.toast.success(this.i18n.t('admin.account.suspended'));
      // Saved here, but the Clerk ban failed (audited server-side).
      if (res.warning)
        this.toast.warn(this.i18n.t('admin.account.idpSyncFailed'));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }

  /** Typed confirmation with the user's email, when known. */
  private typed(): { typeToConfirm?: string } {
    const email = this.email();
    return email ? { typeToConfirm: email } : {};
  }

  protected refundable(p: AdminPaymentView): boolean {
    return (
      (p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED') &&
      p.amountCents - p.refundedCents > 0
    );
  }

  protected refundHelp(p: AdminPaymentView): string {
    const remaining = formatForLocale(
      p.amountCents - p.refundedCents,
      this.i18n.currentLocale(),
      'currency',
      p.currency,
    );
    return this.i18n.t(
      this.isSupport()
        ? 'admin.staff.refund.helpSupport'
        : 'admin.staff.refund.help',
      { remaining },
    );
  }

  protected openRefund(p: AdminPaymentView): void {
    this.refundAmount = (p.amountCents - p.refundedCents) / 100;
    this.refundReason = '';
    this.refundErrors.set({});
    this.refundFor.set(p.id);
  }

  /** Staff refund (docs/09 §5): amount in major units, typed confirmation. */
  protected async refund(ev: Event, p: AdminPaymentView): Promise<void> {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    const remaining = p.amountCents - p.refundedCents;
    const cents = Math.round(Number(this.refundAmount) * 100);
    if (!Number.isFinite(cents) || cents < 1 || cents > remaining)
      errs['amount'] = this.i18n.t('admin.staff.refund.invalidAmount');
    const reason = this.refundReason.trim();
    if (reason.length < 3)
      errs['reason'] = this.i18n.t('admin.account.reasonRequired');
    this.refundErrors.set(errs);
    if (Object.keys(errs).length) return;
    const amount = formatForLocale(
      cents,
      this.i18n.currentLocale(),
      'currency',
      p.currency,
    );
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.staff.refund.confirmTitle', { amount }),
      message: this.i18n.t('admin.staff.refund.confirmMessage', { amount }),
      confirmLabel: this.i18n.t('admin.staff.refund.submit'),
      confirmKind: 'danger',
      ...this.typed(),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.billing.adminRefund(p.id, {
        amountCents: cents,
        reason,
      });
      this.payments.update((list) =>
        (list ?? []).map((x) =>
          x.id === p.id
            ? {
                ...x,
                status: res.after.status,
                refundedCents: res.after.refundedCents,
              }
            : x,
        ),
      );
      this.refundFor.set(null);
      this.toast.success(this.i18n.t('admin.staff.refund.done', { amount }));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async unsuspend(): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.account.unsuspendConfirmTitle'),
      message: this.i18n.t('admin.account.unsuspendConfirmMessage'),
      confirmLabel: this.i18n.t('admin.account.unsuspend'),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.account.unsuspend(this.userId());
      this.status.set(res);
      this.toast.success(this.i18n.t('admin.account.unsuspended'));
      if (res.warning)
        this.toast.warn(this.i18n.t('admin.account.idpUnbanFailed'));
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }
}
