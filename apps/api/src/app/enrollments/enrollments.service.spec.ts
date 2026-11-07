import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service.js';
import type { ApiUser } from '../auth/auth.types.js';

const now = new Date('2026-10-07T12:00:00Z');
const DAY = 86_400_000;
const user = (role: ApiUser['role'], userId = 'actor'): ApiUser => ({
  userId,
  clerkId: `dev-${role}`,
  email: `${role}@codify.local`,
  role,
  displayName: role,
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    userId: 'u1',
    courseId: 'c1',
    source: 'SELF',
    accessUntil: null,
    createdAt: now,
    ...over,
  };
}

function setup(
  opts: {
    course?: { status: string } | null;
    existing?: ReturnType<typeof row> | null;
  } = {},
) {
  const prisma = {
    course: {
      findFirst: jest.fn(async () =>
        opts.course === undefined ? { status: 'PUBLISHED' } : opts.course,
      ),
    },
    user: { findFirst: jest.fn(async () => ({ id: 'u1' })) },
    enrollment: {
      upsert: jest.fn(async (args: { create: Record<string, unknown> }) =>
        row(args.create),
      ),
      findUnique: jest.fn(async () => opts.existing ?? null),
      delete: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
    },
  };
  return { svc: new EnrollmentsService(prisma as never), prisma };
}

describe('EnrollmentsService', () => {
  it('self-enrolls in a published course without overwriting an existing grant', async () => {
    const { svc, prisma } = setup();
    const view = await svc.enroll(user('STUDENT', 'u1'), 'c1');
    expect(view.source).toBe('SELF');
    const args = prisma.enrollment.upsert.mock.calls[0][0] as unknown as {
      update: object;
    };
    expect(args.update).toEqual({});
  });

  it('404s self-enrollment in a draft course', async () => {
    const { svc } = setup({ course: { status: 'DRAFT' } });
    await expect(svc.enroll(user('STUDENT'), 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a student drop a SELF enrollment but not a granted one', async () => {
    const self = setup({ existing: row() });
    await self.svc.unenroll(user('STUDENT', 'u1'), 'c1');
    expect(self.prisma.enrollment.delete).toHaveBeenCalled();

    const granted = setup({ existing: row({ source: 'PROMO' }) });
    await expect(
      granted.svc.unenroll(user('STUDENT', 'u1'), 'c1'),
    ).rejects.toBeInstanceOf(ConflictException);
    // Unenrolling from nothing is a no-op.
    await expect(
      setup().svc.unenroll(user('STUDENT'), 'c1'),
    ).resolves.toBeUndefined();
  });

  it('ADMIN can grant without expiry; SUPPORT is limited to PROMO within 31 days', async () => {
    const admin = setup();
    const v = await admin.svc.grant(
      user('ADMIN'),
      { userId: 'u1', courseId: 'c1', source: 'ADMIN_GRANT' },
      now,
    );
    expect(v.source).toBe('ADMIN_GRANT');
    expect(v.accessUntil).toBeNull();

    const support = setup();
    await expect(
      support.svc.grant(
        user('SUPPORT'),
        {
          userId: 'u1',
          courseId: 'c1',
          source: 'ADMIN_GRANT',
          accessUntil: new Date(now.getTime() + DAY).toISOString(),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      support.svc.grant(
        user('SUPPORT'),
        { userId: 'u1', courseId: 'c1', source: 'PROMO' },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      support.svc.grant(
        user('SUPPORT'),
        {
          userId: 'u1',
          courseId: 'c1',
          source: 'PROMO',
          accessUntil: new Date(now.getTime() + 40 * DAY).toISOString(),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const ok = await support.svc.grant(
      user('SUPPORT'),
      {
        userId: 'u1',
        courseId: 'c1',
        source: 'PROMO',
        accessUntil: new Date(now.getTime() + 14 * DAY).toISOString(),
      },
      now,
    );
    expect(ok.source).toBe('PROMO');
  });

  it('rejects an accessUntil in the past', async () => {
    const { svc } = setup();
    await expect(
      svc.grant(
        user('ADMIN'),
        {
          userId: 'u1',
          courseId: 'c1',
          source: 'PROMO',
          accessUntil: new Date(now.getTime() - DAY).toISOString(),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SUPPORT cannot revoke an ADMIN_GRANT', async () => {
    const { svc } = setup({ existing: row({ source: 'ADMIN_GRANT' }) });
    await expect(svc.revoke(user('SUPPORT'), 'e1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.revoke(user('ADMIN'), 'e1')).resolves.toMatchObject({
      source: 'ADMIN_GRANT',
    });
  });
});
