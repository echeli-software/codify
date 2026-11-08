import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { BirthDateService } from './birth-date.service.js';

// 8 Nov 2026, 12:00 UTC.
const now = new Date('2026-11-08T12:00:00Z');

const student: ApiUser = {
  userId: 'u1',
  clerkId: 'user_1',
  email: 'kid@example.com',
  role: 'STUDENT',
  displayName: 'Kid',
};
const support: ApiUser = { ...student, userId: 'staff', role: 'SUPPORT' };
const admin: ApiUser = { ...student, userId: 'boss', role: 'ADMIN' };

type Row = {
  id: string;
  role: ApiUser['role'];
  birthDate: Date | null;
  timezone: string;
  deletedAt: Date | null;
};

function setup(row: Partial<Row> = {}) {
  const user: Row = {
    id: 'u1',
    role: 'STUDENT',
    birthDate: null,
    timezone: 'America/Sao_Paulo',
    deletedAt: null,
    ...row,
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => user),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => user),
    },
  };
  const users = { getById: jest.fn(async () => ({ id: 'u1' })) };
  const audit = {
    record: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const underAge = {
    deleteNow: jest.fn(async () => ({
      purged: true,
      identityProvider: { status: 'synced' },
    })),
  };
  const svc = new BirthDateService(
    prisma as never,
    users as never,
    audit as never,
    underAge as never,
  );
  return { svc, prisma, users, audit, underAge, user };
}

/** Every audit diff, serialised — must never contain a date of birth. */
const auditText = (audit: { record: jest.Mock }) =>
  JSON.stringify(audit.record.mock.calls);

describe('BirthDateService.setOwn', () => {
  it('stores an adult date once and audits only the age group', async () => {
    const { svc, prisma, audit, users } = setup();
    await svc.setOwn(student, '1990-05-20', now);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', birthDate: null },
      data: { birthDate: new Date('1990-05-20T00:00:00Z') },
    });
    expect(audit.record).toHaveBeenCalledWith(student, {
      action: 'user.birth_date_set',
      entity: 'User',
      entityId: 'u1',
      diff: { ageGroup: 'adult' },
    });
    expect(auditText(audit)).not.toContain('1990');
    expect(users.getById).toHaveBeenCalledWith('u1');
  });

  it('turns the minor defaults on for 12–17', async () => {
    const { svc, prisma, audit } = setup();
    await svc.setOwn(student, '2011-01-15', now);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', birthDate: null },
      data: {
        birthDate: new Date('2011-01-15T00:00:00Z'),
        activityFeedOptIn: false,
        marketingEmailOptIn: false,
      },
    });
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      diff: { ageGroup: 'minor' },
    });
  });

  it('is set once: a second change is 409', async () => {
    const { svc, prisma } = setup({
      birthDate: new Date('1990-05-20T00:00:00Z'),
    });
    await expect(svc.setOwn(student, '1991-01-01', now)).rejects.toMatchObject({
      response: { code: 'BIRTH_DATE_ALREADY_SET' },
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('a concurrent first set loses with 409', async () => {
    const { svc, prisma } = setup();
    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.setOwn(student, '1990-05-20', now)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    ['2010-02-30', 'invalid'],
    ['2026-11-09', 'future'],
    ['1900-01-01', 'too_old'],
  ])('refuses %s (%s)', async (date, reason) => {
    const { svc, prisma } = setup();
    const err = await svc.setOwn(student, date, now).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ code: 'BIRTH_DATE_INVALID', reason });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('judges "the future" on the user’s own calendar day', async () => {
    // 01:30 UTC on the 8th is still the 7th in São Paulo.
    const early = new Date('2026-11-08T01:30:00Z');
    const { svc } = setup();
    await expect(
      svc.setOwn(student, '2026-11-08', early),
    ).rejects.toMatchObject({ response: { reason: 'future' } });
  });

  it('under 12: deletes the account at once and answers AGE_BELOW_MINIMUM', async () => {
    const { svc, prisma, audit, underAge } = setup();
    const err = await svc.setOwn(student, '2015-06-01', now).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({
      code: 'AGE_BELOW_MINIMUM',
      minimumAge: 12,
      accountDeleted: true,
    });
    expect(underAge.deleteNow).toHaveBeenCalledWith('u1', now);
    // Nothing stored, and the audit row (written before the purge) has
    // no date in it.
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(student, {
      action: 'user.deleted_under_age',
      entity: 'User',
      entityId: 'u1',
      diff: { by: 'self', minimumAge: 12 },
    });
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      underAge.deleteNow.mock.invocationCallOrder[0],
    );
    expect(auditText(audit)).not.toContain('2015');
  });

  it('turning 12 today on the local calendar is allowed', async () => {
    const { svc, underAge } = setup({ timezone: 'UTC' });
    await svc.setOwn(student, '2014-11-08', now);
    expect(underAge.deleteNow).not.toHaveBeenCalled();
  });

  it('never deletes an admin account (refused, nothing stored)', async () => {
    const { svc, prisma, underAge } = setup({ id: 'boss', role: 'ADMIN' });
    await expect(svc.setOwn(admin, '2016-01-01', now)).rejects.toMatchObject({
      response: { code: 'AGE_BELOW_MINIMUM', accountDeleted: false },
    });
    expect(underAge.deleteNow).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('404 for an unknown user', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUnique.mockResolvedValueOnce(null as never);
    await expect(svc.setOwn(student, '1990-01-01', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BirthDateService.correct (staff)', () => {
  it('corrects and audits before / after age groups only', async () => {
    const { svc, prisma, audit } = setup({
      birthDate: new Date('1990-05-20T00:00:00Z'),
    });
    const res = await svc.correct(
      support,
      'u1',
      '2010-05-20',
      ' ticket 42 ',
      now,
    );
    expect(res).toEqual({
      userId: 'u1',
      before: { ageGroup: 'adult' },
      after: { ageGroup: 'minor' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        birthDate: new Date('2010-05-20T00:00:00Z'),
        activityFeedOptIn: false,
        marketingEmailOptIn: false,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(support, {
      action: 'user.birth_date_corrected',
      entity: 'User',
      entityId: 'u1',
      before: { ageGroup: 'adult' },
      after: { ageGroup: 'minor' },
      diff: { reason: 'ticket 42' },
    });
    const text = auditText(audit);
    expect(text).not.toContain('1990');
    expect(text).not.toContain('2010');
  });

  it('works for a user who never gave a date (before: null)', async () => {
    const { svc } = setup();
    const res = await svc.correct(admin, 'u1', '1980-01-01', undefined, now);
    expect(res.before).toEqual({ ageGroup: null });
    expect(res.after).toEqual({ ageGroup: 'adult' });
  });

  it('a date under 12 deletes the account', async () => {
    const { svc, underAge, audit, prisma } = setup({
      birthDate: new Date('2012-01-01T00:00:00Z'),
    });
    const res = await svc.correct(admin, 'u1', '2016-01-01', undefined, now);
    expect(res).toEqual({
      userId: 'u1',
      before: { ageGroup: 'minor' },
      after: { deleted: true },
    });
    expect(underAge.deleteNow).toHaveBeenCalledWith('u1', now);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: 'user.birth_date_corrected',
      after: { ageGroup: 'under_minimum', accountDeleted: true },
    });
    expect(auditText(audit)).not.toContain('2016');
  });

  it('refuses correcting yourself, SUPPORT on staff, and deleted accounts', async () => {
    await expect(
      setup().svc.correct(support, 'staff', '1990-01-01', undefined, now),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_CORRECT_SELF' } });
    await expect(
      setup({ role: 'ADMIN' }).svc.correct(
        support,
        'u1',
        '1990-01-01',
        undefined,
        now,
      ),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_ROLE' } });
    await expect(
      setup({ deletedAt: now }).svc.correct(
        admin,
        'u1',
        '1990-01-01',
        undefined,
        now,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never deletes an admin account by correction', async () => {
    const { svc, underAge } = setup({ role: 'ADMIN' });
    await expect(
      svc.correct(
        { ...admin, userId: 'other' },
        'u1',
        '2016-01-01',
        undefined,
        now,
      ),
    ).rejects.toMatchObject({ response: { code: 'AGE_BELOW_MINIMUM' } });
    expect(underAge.deleteNow).not.toHaveBeenCalled();
  });

  it('validates the corrected date', async () => {
    await expect(
      setup().svc.correct(admin, 'u1', '2030-01-01', undefined, now),
    ).rejects.toMatchObject({ response: { code: 'BIRTH_DATE_INVALID' } });
  });
});
