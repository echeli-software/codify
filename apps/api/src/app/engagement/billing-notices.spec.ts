import { DevBillingProvider } from '../billing/billing.provider.js';
import { FakeBillingPrisma } from '../billing/testing/fake-billing-prisma.js';
import { makeWebhookService } from '../billing/testing/fake-billing-deps.js';

/** Billing webhook → NotificationService ("payment received" notice). */
const nowSec = () => Math.floor(Date.now() / 1000);
let seq = 0;
const evt = (
  type: string,
  object: Record<string, unknown>,
  created = nowSec(),
) => ({
  id: `evt_notice_${++seq}`,
  type,
  created,
  data: { object },
});

async function setup() {
  const prisma = new FakeBillingPrisma();
  prisma.state.users.push({ id: 'user-1', coins: 0 });
  prisma.state.plans.push({ id: 'plan-1', deletedAt: null });
  const deps = makeWebhookService(
    prisma,
    new DevBillingProvider('test-secret'),
    {
      config: { 'billing.firstPaymentBonusCoins': 0 },
    },
  );
  const send = (e: { id: string }) =>
    deps.svc.handleStripe(Buffer.from(JSON.stringify(e)), e, undefined);
  await send(
    evt(
      'customer.subscription.created',
      {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        current_period_start: nowSec() - 3600,
        current_period_end: nowSec() + 30 * 86_400,
        cancel_at_period_end: false,
        metadata: { userId: 'user-1', planId: 'plan-1' },
      },
      nowSec() - 600,
    ),
  );
  return { ...deps, send };
}

describe('billing webhook → payment received notice', () => {
  it('invoice.paid sends an inbox + email (no push) BILLING notice with the amount', async () => {
    const ctx = await setup();
    await ctx.send(
      evt('invoice.paid', {
        id: 'in_1',
        subscription: 'sub_1',
        amount_paid: 2990,
        currency: 'brl',
        billing_reason: 'subscription_cycle',
      }),
    );
    expect(ctx.push.sendToUser.calls).toHaveLength(1);
    const [userId, content, opts] = ctx.push.sendToUser.calls[0] as [
      string,
      (u: { locale: string }) => {
        title: string;
        body: string;
        data: Record<string, string>;
        channels: Record<string, boolean>;
      },
      unknown,
    ];
    expect(userId).toBe('user-1');
    expect(opts).toEqual({ kind: 'BILLING' });
    const pt = content({ locale: 'pt-BR' });
    expect(pt.title).toBe('Pagamento recebido');
    expect(pt.body).toMatch(/R\$\s?29,90/);
    expect(pt.channels).toEqual({ push: false });
    expect(content({ locale: 'en-US' }).data).toMatchObject({
      type: 'billing_payment_received',
    });
  });

  it('a $0 invoice (trial start) sends nothing', async () => {
    const ctx = await setup();
    await ctx.send(
      evt('invoice.paid', {
        id: 'in_0',
        subscription: 'sub_1',
        amount_paid: 0,
      }),
    );
    expect(ctx.push.sendToUser.calls).toHaveLength(0);
  });
});
