import { Prisma } from '@prisma/client';
import { BillingJobsService } from './billing-jobs.service.js';
import type { AccessService } from './access.service.js';
import type { PushService } from '../notifications/push.service.js';

const NOW = new Date('2026-10-07T12:43:00Z');
const DAY_MS = 86_400_000;

function setup(
  opts: {
    rows?: Record<string, unknown>[];
    renewedFor?: string[];
    pushStatus?: string;
  } = {},
) {
  const claimed = new Set<string>();
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    subscription: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => opts.rows ?? []),
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
        opts.renewedFor?.includes(where.userId) ? { id: 'other' } : null,
      ),
    },
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (claimed.has(data.key)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        }
        claimed.add(data.key);
        return data;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        claimed.delete(where.key);
        return { count: 1 };
      }),
    },
  };
  const access = { pastDueGraceDays: jest.fn(async () => 3) };
  const push = {
    sendToUser: jest.fn(async () =>
      opts.pushStatus === 'capped'
        ? { status: 'capped', reason: 'daily' }
        : opts.pushStatus === 'deferred'
          ? { status: 'deferred', deliverAt: NOW.toISOString() }
          : { status: 'sent', sent: 1, failed: 0, pruned: 0 },
    ),
  };
  const svc = new BillingJobsService(
    prisma as never,
    access as unknown as AccessService,
    push as unknown as PushService,
  );
  return { svc, prisma, push, claimed };
}

const prepayRow = (over: Record<string, unknown> = {}) => ({
  id: 'sub-row-1',
  userId: 'user-1',
  currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY_MS),
  plan: { name: 'Frontend' },
  user: { timezone: 'America/Sao_Paulo' },
  ...over,
});

describe('BillingJobsService.sweepSubscriptions', () => {
  it('ends cancel-at-period-end rows whose period passed and marks PAST_DUE beyond grace UNPAID', async () => {
    const { svc, prisma } = setup();
    const res = await svc.sweepSubscriptions(NOW);
    expect(res).toEqual({ canceled: 2, unpaid: 1 });

    const [noDate, withDate, unpaid] = prisma.subscription.updateMany.mock
      .calls as unknown as [
      { where: Record<string, unknown>; data: unknown },
    ][];
    const ended = {
      status: { in: ['ACTIVE', 'TRIALING'] },
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lt: NOW },
    };
    expect(noDate[0]).toEqual({
      where: { ...ended, canceledAt: null },
      data: { status: 'CANCELED', canceledAt: NOW },
    });
    expect(withDate[0]).toEqual({
      where: ended,
      data: { status: 'CANCELED' },
    });
    const cutoff = new Date(NOW.getTime() - 3 * DAY_MS);
    expect(unpaid[0]).toEqual({
      where: {
        status: 'PAST_DUE',
        OR: [
          { pastDueSince: { lt: cutoff } },
          { pastDueSince: null, currentPeriodEnd: { lt: cutoff } },
        ],
      },
      data: { status: 'UNPAID' },
    });
  });
});

describe('BillingJobsService.sendRenewalReminders', () => {
  it('targets PIX/Boleto prepay rows ending within 7 days', async () => {
    const { svc, prisma } = setup();
    await svc.sendRenewalReminders(NOW);
    const call = prisma.subscription.findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(call[0].where).toMatchObject({
      source: 'STRIPE_WEB',
      stripeSubscriptionId: { startsWith: 'cs_' },
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: {
        gt: NOW,
        lte: new Date(NOW.getTime() + 7 * DAY_MS),
      },
    });
  });

  it('pushes "renew with PIX" once per subscription per period', async () => {
    const { svc, push, claimed } = setup({ rows: [prepayRow()] });
    expect(await svc.sendRenewalReminders(NOW)).toEqual({
      candidates: 1,
      notified: 1,
      alreadyReminded: 0,
      retryLater: 0,
    });
    const [userId, content, opts] = push.sendToUser.mock
      .calls[0] as unknown as [
      string,
      (u: { locale: string }) => { title: string; body: string },
      unknown,
    ];
    expect(userId).toBe('user-1');
    expect(opts).toEqual({ kind: 'BILLING', now: NOW });
    expect(content({ locale: 'pt-BR' }).body).toMatch(/Renove com PIX/);
    expect(content({ locale: 'pt-BR' }).body).toMatch(/12 de outubro/);
    expect(content({ locale: 'en-US' }).body).toMatch(/Renew with PIX/);

    // Next day's run: already reminded for this period.
    expect(
      await svc.sendRenewalReminders(new Date(NOW.getTime() + DAY_MS)),
    ).toMatchObject({ notified: 0, alreadyReminded: 1 });
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect([...claimed]).toEqual([
      `billing_renewal_reminder:sub-row-1:${prepayRow().currentPeriodEnd.toISOString()}`,
    ]);
  });

  it('a new period (renewed prepay) is reminded again', async () => {
    const first = prepayRow();
    const { svc, prisma, push } = setup({ rows: [first] });
    await svc.sendRenewalReminders(NOW);
    prisma.subscription.findMany.mockResolvedValueOnce([
      prepayRow({
        currentPeriodEnd: new Date(
          first.currentPeriodEnd.getTime() + 365 * DAY_MS,
        ),
      }),
    ]);
    await svc.sendRenewalReminders(NOW);
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('a capped push releases the claim so tomorrow retries; deferred counts as notified', async () => {
    const capped = setup({ rows: [prepayRow()], pushStatus: 'capped' });
    expect(await capped.svc.sendRenewalReminders(NOW)).toMatchObject({
      notified: 0,
      retryLater: 1,
    });
    expect(capped.claimed.size).toBe(0);

    const deferred = setup({ rows: [prepayRow()], pushStatus: 'deferred' });
    expect(await deferred.svc.sendRenewalReminders(NOW)).toMatchObject({
      notified: 1,
    });
    expect(deferred.claimed.size).toBe(1);
  });

  it('skips users who already hold a later-ending subscription', async () => {
    const { svc, push } = setup({
      rows: [prepayRow()],
      renewedFor: ['user-1'],
    });
    expect(await svc.sendRenewalReminders(NOW)).toMatchObject({
      candidates: 0,
    });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});
