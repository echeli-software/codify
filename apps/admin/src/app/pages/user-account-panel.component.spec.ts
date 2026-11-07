import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@codify/i18n';
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
  template: `<cdf-user-account-panel userId="u1" />`,
})
class Host {}

describe('UserAccountPanelComponent', () => {
  async function setup() {
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
    const billing = {
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
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideI18n(),
        { provide: AccountClient, useValue: account },
        { provide: BillingClient, useValue: billing },
        { provide: ConfirmDialogService, useValue: confirm },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const panel = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fixture.debugElement.children[0].componentInstance as any;
    return { fixture, panel, account, billing, confirm };
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
});
