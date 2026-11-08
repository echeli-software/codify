import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ApiUser } from '../auth/auth.types.js';
import { ChangeUserRoleDto } from './user-role.dto.js';
import { UserRoleService } from './user-role.service.js';

const ADMIN: ApiUser = {
  userId: 'admin-1',
  clerkId: 'c-admin',
  email: 'admin@x.dev',
  role: 'ADMIN',
  displayName: 'Admin',
};

function setup(row: Record<string, unknown> | null, count = 1) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count })),
    },
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    svc: new UserRoleService(prisma as never, audit as never),
    prisma,
    audit,
  };
}

const target = {
  id: 'u-2',
  email: 'ana@x.dev',
  displayName: 'Ana',
  role: 'STUDENT',
  purgedAt: null,
};

describe('UserRoleService.changeRole', () => {
  it('changes the role optimistically and audits user.role_changed with before/after', async () => {
    const { svc, prisma, audit } = setup(target);
    const res = await svc.changeRole(ADMIN, 'u-2', 'TEACHER', ' promoted ');
    expect(res).toEqual({
      id: 'u-2',
      email: 'ana@x.dev',
      displayName: 'Ana',
      role: 'TEACHER',
      previousRole: 'STUDENT',
      changed: true,
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-2', role: 'STUDENT' },
      data: { role: 'TEACHER' },
    });
    expect(audit.record).toHaveBeenCalledWith(ADMIN, {
      action: 'user.role_changed',
      entity: 'User',
      entityId: 'u-2',
      before: { role: 'STUDENT' },
      after: { role: 'TEACHER' },
      diff: { reason: 'promoted' },
    });
  });

  it('refuses to change your own role (403 ROLE_CHANGE_SELF)', async () => {
    const { svc, prisma } = setup(target);
    await expect(
      svc.changeRole(ADMIN, 'admin-1', 'STUDENT'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'ROLE_CHANGE_SELF' },
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op (no audit) when the role is unchanged', async () => {
    const { svc, prisma, audit } = setup(target);
    const res = await svc.changeRole(ADMIN, 'u-2', 'STUDENT');
    expect(res.changed).toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s unknown or purged users; 409 when the role changed meanwhile', async () => {
    await expect(
      setup(null).svc.changeRole(ADMIN, 'u-x', 'ADMIN'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setup({ ...target, purgedAt: new Date() }).svc.changeRole(
        ADMIN,
        'u-2',
        'ADMIN',
      ),
    ).rejects.toMatchObject({ status: 404 });
    const raced = setup(target, 0);
    await expect(
      raced.svc.changeRole(ADMIN, 'u-2', 'ADMIN'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_CHANGED_CONCURRENTLY' },
    });
    expect(raced.audit.record).not.toHaveBeenCalled();
  });
});

describe('ChangeUserRoleDto', () => {
  it('accepts the four roles only', () => {
    const errs = (b: object) =>
      validateSync(plainToInstance(ChangeUserRoleDto, b)).map(
        (e) => e.property,
      );
    expect(errs({ role: 'SUPPORT' })).toEqual([]);
    expect(errs({ role: 'ROOT' })).toEqual(['role']);
    expect(errs({ role: 'ADMIN', reason: 'x'.repeat(501) })).toEqual([
      'reason',
    ]);
  });
});
