import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

const price = (over: Record<string, unknown> = {}) => ({
  id: 'pr1',
  planId: 'p1',
  currency: 'BRL',
  amountCents: 2990,
  period: 'MONTHLY',
  maxInstallments: null,
  isActive: true,
  stripePriceId: null,
  storeProductId: null,
  ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'pro',
  name: 'Pro',
  description: null,
  tagline: null,
  isAllAccess: true,
  revenueCatEntitlementId: null,
  isActive: true,
  trialDays: 7,
  sortOrder: 0,
  stripeProductId: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  prices: [price()],
  categories: [{ categoryId: 'cat1' }],
  ...over,
});

const actor = { userId: 'a1', role: 'ADMIN' } as never;
const req = {
  ip: '1.2.3.4',
  headers: { 'user-agent': 'jest' },
} as never as Request;

/**
 * An in-memory plan row: `findFirst` reads the current state, the writes
 * mutate it, so the "after" read sees the change.
 */
function setup() {
  let current = plan();
  const tx = {
    plan: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        current = { ...current, ...data };
        return current;
      }),
    },
    planCategory: {
      deleteMany: jest.fn(async () => ({ count: 1 })),
      createMany: jest.fn(
        async ({ data }: { data: { categoryId: string }[] }) => {
          current = {
            ...current,
            categories: data.map((d) => ({ categoryId: d.categoryId })),
          };
          return { count: data.length };
        },
      ),
    },
  };
  const prisma = {
    plan: {
      findFirst: jest.fn(async (): Promise<unknown> => current),
      findUnique: jest.fn(async () => null),
      update: tx.plan.update,
    },
    planPrice: {
      findFirst: jest.fn(async (): Promise<unknown> => current.prices[0]),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const next = { ...current.prices[0], ...data };
        current = { ...current, prices: [next] };
        return next;
      }),
      delete: jest.fn(async () => {
        const [removed] = current.prices;
        current = { ...current, prices: [] };
        return removed;
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const svc = new PlansService(prisma as never, {} as never);
  const audit = {
    record: jest.fn<Promise<void>, [unknown, unknown]>(async () => undefined),
  };
  const ctrl = new PlansController(svc, audit as never);
  return { svc, ctrl, prisma, audit };
}

describe('Plan audit before-state (SEC-3)', () => {
  it('PATCH returns and audits the plan before and after', async () => {
    const { ctrl, audit } = setup();
    const res = await ctrl.update(
      actor,
      'p1',
      { name: 'Pro+', trialDays: 14, categoryIds: ['cat2'] },
      req,
    );
    expect(res).toEqual(
      expect.objectContaining({
        name: 'Pro+',
        trialDays: 14,
        categoryIds: ['cat2'],
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        action: 'plan.update',
        entity: 'Plan',
        entityId: 'p1',
        ip: '1.2.3.4',
        before: expect.objectContaining({
          name: 'Pro',
          trialDays: 7,
          categoryIds: ['cat1'],
          prices: [expect.objectContaining({ id: 'pr1', amountCents: 2990 })],
        }),
        after: expect.objectContaining({
          name: 'Pro+',
          trialDays: 14,
          categoryIds: ['cat2'],
        }),
      }),
    );
    const { before } = audit.record.mock.calls[0][1] as {
      before: Record<string, unknown>;
    };
    expect(before).not.toHaveProperty('updatedAt');
  });

  it('DELETE soft-deletes and audits the plan as it was', async () => {
    const { ctrl, audit, prisma } = setup();
    await ctrl.remove(actor, 'p1', req);
    expect(prisma.plan.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { deletedAt: expect.any(Date), isActive: false },
    });
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        action: 'plan.delete',
        before: expect.objectContaining({
          slug: 'pro',
          isActive: true,
          prices: [expect.objectContaining({ id: 'pr1' })],
        }),
      }),
    );
  });

  it('price PATCH and DELETE audit the price line before (and after)', async () => {
    const { ctrl, audit } = setup();
    const res = await ctrl.updatePrice(
      actor,
      'p1',
      'pr1',
      { isActive: false },
      req,
    );
    expect(res.prices[0].isActive).toBe(false);
    expect(audit.record).toHaveBeenLastCalledWith(
      actor,
      expect.objectContaining({
        action: 'plan.price.update',
        diff: { priceId: 'pr1' },
        before: expect.objectContaining({ id: 'pr1', isActive: true }),
        after: expect.objectContaining({ id: 'pr1', isActive: false }),
      }),
    );

    const after = await ctrl.removePrice(actor, 'p1', 'pr1', req);
    expect(after.prices).toEqual([]);
    expect(audit.record).toHaveBeenLastCalledWith(
      actor,
      expect.objectContaining({
        action: 'plan.price.remove',
        before: expect.objectContaining({ id: 'pr1', amountCents: 2990 }),
      }),
    );
  });

  it('an unknown plan is a 404 and writes no audit row', async () => {
    const { ctrl, audit, prisma } = setup();
    prisma.plan.findFirst.mockResolvedValueOnce(null);
    await expect(
      ctrl.update(actor, 'nope', { name: 'X' }, req),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
