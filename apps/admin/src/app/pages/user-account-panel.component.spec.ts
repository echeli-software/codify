import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import {
  AccountClient,
  BillingClient,
  type AdminAccountStatusView,
} from '@codify/api-client';
import { UserAccountPanelComponent } from './user-account-panel.component';

const status = (
  over: Partial<AdminAccountStatusView> = {},
): AdminAccountStatusView => ({
  status: 'active',
  deletedAt: null,
  deletionRequestedAt: null,
  restorableUntil: null,
  purgeAt: null,
  suspendedAt: null,
  userId: 'u1',
  role: 'STUDENT',
  suspendedReason: null,
  purgedAt: null,
  ...over,
});

@Component({
  imports: [UserAccountPanelComponent],
  template: `<cdf-user-account-panel userId="u1" email="ana@x.y" />`,
})
class Host {}

describe('UserAccountPanelComponent', () => {
  async function setup(role: 'ADMIN' | 'SUPPORT' = 'ADMIN') {
    const account = {
      adminStatus: jest.fn().mockResolvedValue(status()),
      suspend: jest.fn().mockResolvedValue(
        status({
          status: 'suspended',
          suspendedAt: '2026-11-07T12:00:00.000Z',
          suspendedReason: 'spam',
        }),
      ),
      unsuspend: jest.fn().mockResolvedValue(status()),
    };
    const refundOutcome = {
      paymentId: 'p1',
      refund: {
        id: 're_1',
        status: 'succeeded',
        amountCents: 2000,
        currency: 'BRL',
      },
      before: { status: 'PARTIALLY_REFUNDED', refundedCents: 990 },
      after: { status: 'REFUNDED', refundedCents: 2990 },
      accessEnded: true,
    };
    const billing = {
      adminRefund: jest.fn().mockResolvedValue(refundOutcome),
      adminUserPayments: jest.fn().mockResolvedValue({
        total: 1,
        items: [
          {
            id: 'p1',
            userId: 'u1',
            externalId: 'in_1',
            provider: 'STRIPE',
            amountCents: 2990,
            currency: 'BRL',
            status: 'PARTIALLY_REFUNDED',
            method: 'card',
            refundedCents: 990,
            receiptUrl: 'https://invoice.stripe.com/i/1',
            paidAt: '2026-11-01T00:00:00.000Z',
            createdAt: '2026-11-01T00:00:00.000Z',
            subscriptionId: null,
            planName: null,
          },
        ],
      }),
    };
    const confirm = { open: jest.fn().mockResolvedValue(true) };
    const toast = { success: jest.fn(), error: jest.fn(), warn: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideI18n(),
        { provide: AccountClient, useValue: account },
        { provide: BillingClient, useValue: billing },
        { provide: ConfirmDialogService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { role: () => role } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const panel = // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fixture.debugElement.children[0].componentInstance as any;
    return { fixture, panel, account, billing, confirm, toast };
  }

  it('loads status and payments for the user', async () => {
    const { fixture, account, billing } = await setup();
    expect(account.adminStatus).toHaveBeenCalledWith('u1');
    expect(billing.adminUserPayments).toHaveBeenCalledWith('u1', {
      skip: 0,
      take: 10,
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[data-testid="payment-row"]')).toHaveLength(1);
    expect(el.textContent).toContain('in_1');
    expect(el.querySelector('[data-testid="suspend-form"]')).not.toBeNull();
  });

  it('requires a reason, confirms, suspends, then unsuspends', async () => {
    const { fixture, panel, account, confirm } = await setup();
    panel.reason = ' x ';
    await panel.suspend(new Event('submit'));
    expect(account.suspend).not.toHaveBeenCalled();
    expect(panel.reasonError()).toBeTruthy();

    panel.reason = 'Spam in friend requests';
    await panel.suspend(new Event('submit'));
    expect(confirm.open).toHaveBeenCalledTimes(1);
    expect(account.suspend).toHaveBeenCalledWith(
      'u1',
      'Spam in friend requests',
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="unsuspend"]'),
    ).not.toBeNull();

    await panel.unsuspend();
    expect(account.unsuspend).toHaveBeenCalledWith('u1');
    expect(panel.status().status).toBe('active');
  });

  it('warns when the identity provider ban failed', async () => {
    const { panel, account, toast } = await setup();
    account.suspend.mockResolvedValueOnce(
      status({
        status: 'suspended',
        suspendedAt: '2026-11-07T12:00:00.000Z',
        suspendedReason: 'spam',
        warning: { code: 'IDP_SYNC_FAILED', message: 'HTTP 500' },
      } as never),
    );
    panel.reason = 'Spam in friend requests';
    await panel.suspend(new Event('submit'));
    expect(panel.status().status).toBe('suspended');
    expect(toast.warn).toHaveBeenCalledWith(expect.stringContaining('Clerk'));
  });
});

describe('UserAccountPanelComponent — typed confirmation + refunds', () => {
  @Component({
    imports: [UserAccountPanelComponent],
    template: `<cdf-user-account-panel userId="u1" email="ana@x.y" />`,
  })
  class RefundHost {}

  async function mount() {
    const billing = {
      adminUserPayments: jest.fn().mockResolvedValue({
        total: 2,
        items: [
          {
            id: 'p1',
            userId: 'u1',
            externalId: 'in_1',
            provider: 'STRIPE',
            amountCents: 2990,
            currency: 'BRL',
            status: 'PARTIALLY_REFUNDED',
            method: 'card',
            refundedCents: 990,
            receiptUrl: null,
            paidAt: '2026-11-01T00:00:00.000Z',
            createdAt: '2026-11-01T00:00:00.000Z',
            subscriptionId: null,
            planName: null,
          },
          {
            id: 'p2',
            userId: 'u1',
            externalId: 'tx_1',
            provider: 'APPLE',
            amountCents: 2990,
            currency: 'BRL',
            status: 'PAID',
            method: 'store',
            refundedCents: 0,
            receiptUrl: null,
            paidAt: '2026-10-01T00:00:00.000Z',
            createdAt: '2026-10-01T00:00:00.000Z',
            subscriptionId: null,
            planName: null,
          },
        ],
      }),
      adminRefund: jest.fn().mockResolvedValue({
        paymentId: 'p1',
        refund: {
          id: 're_1',
          status: 'succeeded',
          amountCents: 2000,
          currency: 'BRL',
        },
        before: { status: 'PARTIALLY_REFUNDED', refundedCents: 990 },
        after: { status: 'REFUNDED', refundedCents: 2990 },
        accessEnded: false,
      }),
    };
    const account = {
      adminStatus: jest.fn().mockResolvedValue(status()),
      suspend: jest.fn().mockResolvedValue(status({ status: 'suspended' })),
    };
    const confirm = { open: jest.fn().mockResolvedValue(true) };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [RefundHost],
      providers: [
        provideI18n(),
        { provide: AccountClient, useValue: account },
        { provide: BillingClient, useValue: billing },
        { provide: ConfirmDialogService, useValue: confirm },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: AuthService, useValue: { role: () => 'SUPPORT' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(RefundHost);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const panel = // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fixture.debugElement.children[0].componentInstance as any;
    return { fixture, panel, billing, account, confirm };
  }

  it('suspension asks for the email to be typed', async () => {
    const { panel, confirm } = await mount();
    panel.reason = 'Spam in profile';
    await panel.suspend(new Event('submit'));
    expect(confirm.open).toHaveBeenCalledWith(
      expect.objectContaining({
        typeToConfirm: 'ana@x.y',
        confirmKind: 'danger',
      }),
    );
  });

  it('refunds a web payment in cents after a typed confirmation; store rows point to the store', async () => {
    const { fixture, panel, billing, confirm } = await mount();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="store-refund"]')).not.toBeNull();
    const btn = el.querySelector('[data-refund="p1"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(el.querySelector('[data-refund="p2"]')).toBeNull();

    const p1 = panel.payments()[0];
    panel.openRefund(p1);
    expect(panel.refundAmount).toBe(20);
    panel.refundReason = 'x';
    await panel.refund(new Event('submit'), p1);
    expect(billing.adminRefund).not.toHaveBeenCalled();

    panel.refundAmount = 30; // more than what is left
    panel.refundReason = 'Charged twice';
    await panel.refund(new Event('submit'), p1);
    expect(billing.adminRefund).not.toHaveBeenCalled();

    panel.refundAmount = 20;
    await panel.refund(new Event('submit'), p1);
    expect(confirm.open).toHaveBeenCalledWith(
      expect.objectContaining({ typeToConfirm: 'ana@x.y' }),
    );
    expect(billing.adminRefund).toHaveBeenCalledWith('p1', {
      amountCents: 2000,
      reason: 'Charged twice',
    });
    expect(panel.payments()[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 2990,
    });
  });
});
