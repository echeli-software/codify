import type { Request } from 'express';
import type { ApiUser } from '../auth/auth.types.js';
import { AdminAccountController } from './account.controller.js';

const admin = {
  userId: 'a1',
  role: 'ADMIN',
  clerkId: 'user_admin',
  email: 'a@x.y',
  displayName: 'A',
} as ApiUser;
const req = {
  ip: '1.2.3.4',
  headers: { 'user-agent': 'jest' },
} as never as Request;
const view = (status: string) => ({
  userId: 'u1',
  role: 'STUDENT',
  status,
  suspendedAt: status === 'suspended' ? '2026-11-07T12:00:00.000Z' : null,
  suspendedReason: status === 'suspended' ? 'spam' : null,
});

function setup(identityProvider: unknown) {
  const account = {
    suspend: jest.fn(async () => ({
      before: view('active'),
      after: view('suspended'),
      identityProvider,
    })),
    unsuspend: jest.fn(async () => ({
      before: view('suspended'),
      after: view('active'),
      identityProvider,
    })),
  };
  const audit = {
    record: jest.fn(
      async (_actor: unknown, _input: { action: string }) => undefined,
    ),
  };
  const ctrl = new AdminAccountController(account as never, audit as never);
  return { ctrl, audit };
}

describe('AdminAccountController — identity provider sync', () => {
  it('returns the plain view when Clerk synced or was skipped', async () => {
    for (const outcome of [
      { status: 'synced' },
      { status: 'skipped', reason: 'no_clerk_id' },
    ]) {
      const { ctrl, audit } = setup(outcome);
      const res = await ctrl.suspend(admin, 'u1', { reason: 'spam' }, req);
      expect(res).not.toHaveProperty('warning');
      expect(audit.record.mock.calls.map((c) => c[1].action)).toEqual([
        'user.suspended',
      ]);
    }
  });

  it('audits a failed ban / unban and returns a warning', async () => {
    const { ctrl, audit } = setup({ status: 'failed', error: 'HTTP 500' });
    const res = await ctrl.suspend(admin, 'u1', { reason: 'spam' }, req);
    expect(res.status).toBe('suspended');
    expect(res.warning).toMatchObject({ code: 'IDP_SYNC_FAILED' });
    expect(audit.record).toHaveBeenLastCalledWith(
      admin,
      expect.objectContaining({
        action: 'user.idp_sync_failed',
        entityId: 'u1',
        diff: { op: 'ban', error: 'HTTP 500' },
      }),
    );
    const un = await ctrl.unsuspend(admin, 'u1', req);
    expect(un.status).toBe('active');
    expect(un.warning?.message).toContain('unban');
  });
});
