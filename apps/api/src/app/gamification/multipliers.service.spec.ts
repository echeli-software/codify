import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MultipliersService } from './multipliers.service.js';
import { MultipliersController } from './multipliers.controller.js';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  kind: 'CAMPAIGN',
  target: 'BOTH',
  value: new Prisma.Decimal(2),
  startsAt: null,
  endsAt: null,
  courseId: null,
  lessonId: null,
  streakDaysMin: null,
  description: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

function makePrisma(current = row()) {
  return {
    multiplier: {
      findUnique: jest.fn(async () => current),
      findMany: jest.fn(
        async (_args: { where: { isActive?: boolean; AND?: unknown[] } }) => [
          current,
        ],
      ),
      create: jest.fn(async ({ data }: { data: object }) => ({
        ...current,
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const merged: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(data))
          if (v !== undefined) merged[k] = v;
        return merged;
      }),
      delete: jest.fn(),
    },
  };
}

describe('MultipliersService', () => {
  it('PATCH can set every field', async () => {
    const prisma = makePrisma(row({ kind: 'COURSE_PROMO', courseId: 'c1' }));
    const svc = new MultipliersService(prisma as never);
    const res = await svc.update('m1', {
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-08T00:00:00Z',
      courseId: 'c2',
      lessonId: null,
      streakDaysMin: null,
      target: 'COINS',
      value: 4,
      isActive: false,
    });
    const data = prisma.multiplier.update.mock.calls[0][0].data;
    expect(data.startsAt).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(data.endsAt).toEqual(new Date('2026-06-08T00:00:00Z'));
    expect(data.courseId).toBe('c2');
    expect(data.lessonId).toBeNull();
    expect(data.target).toBe('COINS');
    expect(Number(data.value)).toBe(4);
    expect(data.isActive).toBe(false);
    expect(res.after.activeNow).toBe(false);
    expect(res.before).toEqual(
      expect.objectContaining({ courseId: 'c1', target: 'BOTH', value: 2 }),
    );
  });

  it('rejects endsAt ≤ startsAt, including against the stored bound', async () => {
    const prisma = makePrisma(
      row({ startsAt: new Date('2026-06-10T00:00:00Z') }),
    );
    const svc = new MultipliersService(prisma as never);
    await expect(
      svc.update('m1', { endsAt: '2026-06-09T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.multiplier.update).not.toHaveBeenCalled();
  });

  it('rejects a non-positive value and a promo without its binding', async () => {
    const svc = new MultipliersService(makePrisma() as never);
    await expect(
      svc.create({ kind: 'CAMPAIGN', value: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create({ kind: 'LESSON_PROMO', value: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clearing the course of a COURSE_PROMO is rejected', async () => {
    const svc = new MultipliersService(
      makePrisma(row({ kind: 'COURSE_PROMO', courseId: 'c1' })) as never,
    );
    await expect(svc.update('m1', { courseId: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404 on unknown id', async () => {
    const prisma = makePrisma();
    prisma.multiplier.findUnique.mockResolvedValueOnce(null as never);
    const svc = new MultipliersService(prisma as never);
    await expect(svc.update('nope', { value: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('?active=now filters to enabled rules inside their window', async () => {
    const prisma = makePrisma();
    const svc = new MultipliersService(prisma as never);
    const res = await svc.list({ active: 'now' });
    const where = prisma.multiplier.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.AND).toHaveLength(2);
    expect(res[0].activeNow).toBe(true);
  });
});

describe('Multiplier audit before-state (SEC-3)', () => {
  const actor = { userId: 'a1', role: 'ADMIN' } as never;
  const audit = () => ({
    record: jest.fn<Promise<void>, [unknown, unknown]>(async () => undefined),
  });

  it('PATCH audits the stored rule before and after', async () => {
    const prisma = makePrisma(row({ value: new Prisma.Decimal(2) }));
    const log = audit();
    const ctrl = new MultipliersController(
      new MultipliersService(prisma as never),
      log as never,
    );
    const res = await ctrl.update(actor, 'm1', { value: 3, isActive: false });
    expect(res.value).toBe(3);
    const input = log.record.mock.calls[0][1] as {
      action: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(input.action).toBe('multiplier.update');
    expect(input.before).toEqual(
      expect.objectContaining({ id: 'm1', value: 2, isActive: true }),
    );
    expect(input.after).toEqual(
      expect.objectContaining({ id: 'm1', value: 3, isActive: false }),
    );
    expect(input.before).not.toHaveProperty('activeNow');
  });

  it('DELETE audits the removed rule', async () => {
    const prisma = makePrisma(row({ description: 'Black Friday' }));
    const log = audit();
    const ctrl = new MultipliersController(
      new MultipliersService(prisma as never),
      log as never,
    );
    await ctrl.remove(actor, 'm1');
    expect(prisma.multiplier.delete).toHaveBeenCalledWith({
      where: { id: 'm1' },
    });
    expect(log.record).toHaveBeenCalledWith(actor, {
      action: 'multiplier.delete',
      entity: 'Multiplier',
      entityId: 'm1',
      before: expect.objectContaining({
        kind: 'CAMPAIGN',
        value: 2,
        description: 'Black Friday',
      }),
    });
  });

  it('an unknown id is a 404 and writes no audit row', async () => {
    const prisma = makePrisma();
    prisma.multiplier.findUnique.mockResolvedValueOnce(null as never);
    const log = audit();
    const ctrl = new MultipliersController(
      new MultipliersService(prisma as never),
      log as never,
    );
    await expect(ctrl.remove(actor, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(log.record).not.toHaveBeenCalled();
  });
});
