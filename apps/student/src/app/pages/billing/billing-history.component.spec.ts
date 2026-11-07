import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { I18nService, provideI18n } from '@codify/i18n';
import { BillingClient, type PaymentView } from '@codify/api-client';
import { BillingHistoryComponent } from './billing-history.component';

const pay = (over: Partial<PaymentView> = {}): PaymentView => ({
  id: 'p1',
  provider: 'STRIPE',
  amountCents: 2990,
  currency: 'BRL',
  status: 'PAID',
  method: 'pix',
  refundedCents: 0,
  receiptUrl: 'https://invoice.stripe.com/i/1',
  paidAt: '2026-11-01T12:00:00.000Z',
  createdAt: '2026-11-01T12:00:00.000Z',
  subscriptionId: 's1',
  planName: 'Pro',
  ...over,
});

async function render(myPayments: jest.Mock) {
  await TestBed.configureTestingModule({
    imports: [BillingHistoryComponent],
    providers: [
      provideIonicAngular(),
      provideI18n(),
      { provide: BillingClient, useValue: { myPayments } },
    ],
  }).compileComponents();
  TestBed.inject(I18nService).setLocale('en-US');
  const fixture = TestBed.createComponent(BillingHistoryComponent);
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  return fixture;
}

describe('BillingHistoryComponent', () => {
  it('lists payments with amount, method, status and receipt; pages with "more"', async () => {
    const myPayments = jest
      .fn()
      .mockResolvedValueOnce({ items: [pay()], total: 2 })
      .mockResolvedValueOnce({
        items: [
          pay({
            id: 'p2',
            status: 'PARTIALLY_REFUNDED',
            refundedCents: 1000,
            method: null,
            receiptUrl: null,
          }),
        ],
        total: 2,
      });
    const fixture = await render(myPayments);
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('[data-testid="payment-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('R$');
    expect(rows[0].textContent).toContain('29.90');
    expect(rows[0].textContent).toContain('PIX');
    expect(rows[0].textContent).toContain('Paid');
    const link = rows[0].querySelector('a') as HTMLAnchorElement;
    expect(link.href).toBe('https://invoice.stripe.com/i/1');
    expect(link.rel).toContain('noopener');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (fixture.componentInstance as any).more();
    fixture.detectChanges();
    expect(myPayments).toHaveBeenLastCalledWith({ skip: 1, take: 10 });
    const all = el.querySelectorAll('[data-testid="payment-row"]');
    expect(all).toHaveLength(2);
    expect(all[1].textContent).toContain('Partially refunded');
    expect(all[1].textContent).toContain('R$10.00 refunded');
    expect(all[1].textContent).toContain('Other');
    expect(el.querySelector('[data-testid="billing-history-more"]')).toBeNull();
  });

  it('shows the empty state', async () => {
    const fixture = await render(
      jest.fn().mockResolvedValue({ items: [], total: 0 }),
    );
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="billing-history-empty"]',
      ),
    ).not.toBeNull();
  });
});
