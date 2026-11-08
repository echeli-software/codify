import { ConflictException } from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { AccountService } from './account.service.js';

const DAY = 86_400_000;

interface UserRow {
  id: string;
  role: ApiUser['role'];
  deletedAt: Date | null;
  deletionRequestedAt: Date | null;
  purgedAt: Date | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
}

function setup(users: Partial<UserRow>[]) {
  const rows: UserRow[] = users.map((u, i) => ({
    id: `u${i + 1}`,
    role: 'STUDENT',
    deletedAt: null,
    deletionRequestedAt: null,
    purgedAt: null,
    suspendedAt: null,
    suspendedReason: null,
    ...u,
  }));
  const deviceTokens = [
    { userId: 'u1', token: 't1' },
    { userId: 'u2', token: 't2' },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<UserRow>;
        }) => {
          const r = rows.find((x) => x.id === where.id)!;
          Object.assign(r, data);
          return r;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; deletedAt: Date; purgedAt: null };
          data: Partial<UserRow>;
        }) => {
          const r = rows.find(
            (x) =>
              x.id === where.id &&
              x.deletedAt?.getTime() === where.deletedAt.getTime() &&
              x.purgedAt === null,
          );
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      ),
    },
    deviceToken: {
      deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const before = deviceTokens.length;
        for (let i = deviceTokens.length - 1; i >= 0; i--)
          if (deviceTokens[i].userId === where.userId)
            deviceTokens.splice(i, 1);
        return { count: before - deviceTokens.length };
      }),
    },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
  };
  const billing = {
    stopAutoRenewForUser: jest.fn(async () => ({
      stopped: [{ id: 'sub-web', planName: 'Pro' }],
      store: [{ id: 'sub-ios', planName: 'Pro', source: 'APPLE_IAP' }],
    })),
  };
  const clerk = {
    setBanned: jest.fn(async () => ({ status: 'synced' as const })),
  };
  const notifications = {
    notify: jest.fn(async (userId: string) => ({
      status: 'ok',
      // Tokens still exist when the SYSTEM notice goes out.
      tokensAtSend: deviceTokens.filter((t) => t.userId === userId).length,
    })),
  };
  const svc = new AccountService(
    prisma as never,
    billing as never,
    clerk as never,
    notifications as never,
  );
  return { svc, rows, prisma, billing, deviceTokens, clerk, notifications };
}

const actor = (userId: string, role: ApiUser['role'] = 'STUDENT'): ApiUser => ({
  userId,
  role,
  clerkId: `c-${userId}`,
  email: `${userId}@x.y`,
  displayName: userId,
});

describe('AccountService', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('requestDeletion: stops auto-renew, drops device tokens, opens the restore window', async () => {
    const { svc, rows, billing, deviceTokens } = setup([{}, {}]);
    const res = await svc.requestDeletion(actor('u1'), now);
    expect(billing.stopAutoRenewForUser).toHaveBeenCalledWith('u1');
    expect(rows[0]).toMatchObject({ deletedAt: now, deletionRequestedAt: now });
    expect(deviceTokens.map((t) => t.userId)).toEqual(['u2']);
    expect(res).toMatchObject({
      status: 'deleted',
      restorableUntil: new Date(now.getTime() + 14 * DAY).toISOString(),
      purgeAt: new Date(now.getTime() + 30 * DAY).toISOString(),
      autoRenewStopped: [{ id: 'sub-web' }],
      storeSubscriptions: [{ id: 'sub-ios', source: 'APPLE_IAP' }],
    });
  });

  it('requestDeletion: a provider failure marks nothing', async () => {
    const { svc, rows, billing } = setup([{}]);
    billing.stopAutoRenewForUser.mockRejectedValueOnce(
      new Error('stripe down'),
    );
    await expect(svc.requestDeletion(actor('u1'), now)).rejects.toThrow(
      'stripe down',
    );
    expect(rows[0].deletedAt).toBeNull();
  });

  it('requestDeletion: admins cannot self-delete', async () => {
    const { svc } = setup([{ role: 'ADMIN' }]);
    await expect(
      svc.requestDeletion(actor('u1', 'ADMIN'), now),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_SELF_DELETE' } });
  });

  it('restore: inside the window clears both fields', async () => {
    const at = new Date(now.getTime() - 5 * DAY);
    const { svc, rows } = setup([{ deletedAt: at, deletionRequestedAt: at }]);
    const res = await svc.restore('u1', now);
    expect(res.status).toBe('active');
    expect(rows[0]).toMatchObject({
      deletedAt: null,
      deletionRequestedAt: null,
    });
  });

  it('restore: refused after 14 days, for provider deletions and when not deleted', async () => {
    const old = new Date(now.getTime() - 15 * DAY);
    const { svc } = setup([
      { deletedAt: old, deletionRequestedAt: old },
      { deletedAt: now },
      {},
    ]);
    await expect(svc.restore('u1', now)).rejects.toMatchObject({
      response: { code: 'RESTORE_WINDOW_PASSED' },
    });
    await expect(svc.restore('u2', now)).rejects.toMatchObject({
      response: { code: 'RESTORE_WINDOW_PASSED' },
    });
    await expect(svc.restore('u3', now)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('suspend / unsuspend with role rules', async () => {
    const { svc, rows, deviceTokens } = setup([
      { role: 'STUDENT' },
      { role: 'SUPPORT' },
      { role: 'ADMIN' },
    ]);
    const { after } = await svc.suspend(
      actor('u2', 'SUPPORT'),
      'u1',
      'spam',
      now,
    );
    expect(after).toMatchObject({
      status: 'suspended',
      suspendedReason: 'spam',
      suspendedAt: now.toISOString(),
    });
    expect(deviceTokens.some((t) => t.userId === 'u1')).toBe(false);
    // Re-suspending keeps the original timestamp, updates the reason.
    const later = new Date(now.getTime() + DAY);
    const again = await svc.suspend(actor('u3', 'ADMIN'), 'u1', 'abuse', later);
    expect(again.after).toMatchObject({
      suspendedAt: now.toISOString(),
      suspendedReason: 'abuse',
    });

    await expect(
      svc.suspend(actor('u2', 'SUPPORT'), 'u3', 'x'.repeat(5), now),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_ROLE' } });
    await expect(
      svc.suspend(actor('u3', 'ADMIN'), 'u3', 'self', now),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_SUSPEND_SELF' } });
    expect(
      (await svc.suspend(actor('u3', 'ADMIN'), 'u2', 'staff', now)).after
        .status,
    ).toBe('suspended');

    const un = await svc.unsuspend(actor('u3', 'ADMIN'), 'u1', now);
    expect(un.before.suspendedReason).toBe('abuse');
    expect(un.after).toMatchObject({ status: 'active', suspendedReason: null });
    expect(rows[0].suspendedAt).toBeNull();
  });

  it('sends one SYSTEM notice on suspension, before device tokens are dropped', async () => {
    const { svc, notifications, deviceTokens } = setup([
      { role: 'STUDENT' },
      { role: 'ADMIN' },
    ]);
    const hadTokens = deviceTokens.some((t) => t.userId === 'u1');
    await svc.suspend(actor('u2', 'ADMIN'), 'u1', 'spam', now);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const [userId, content] = notifications.notify.mock.calls[0] as unknown as [
      string,
      (u: { locale: string }) => { kind: string; title: string; body: string },
    ];
    expect(userId).toBe('u1');
    const en = content({ locale: 'en-US' });
    expect(en.kind).toBe('SYSTEM');
    expect(en.body).not.toContain('spam');
    expect(content({ locale: 'pt-BR' }).title).toBe('Sua conta foi suspensa');
    if (hadTokens)
      await expect(
        notifications.notify.mock.results[0].value,
      ).resolves.toMatchObject({ tokensAtSend: 1 });
    // A reason edit on an already-suspended account is not re-announced.
    await svc.suspend(actor('u2', 'ADMIN'), 'u1', 'abuse', now);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('mirrors suspend / unsuspend as a Clerk ban / unban', async () => {
    const { svc, clerk } = setup([
      { role: 'STUDENT', clerkId: 'user_abc' } as Partial<UserRow>,
      { role: 'ADMIN' },
    ]);
    const s1 = await svc.suspend(actor('u2', 'ADMIN'), 'u1', 'spam', now);
    expect(clerk.setBanned).toHaveBeenLastCalledWith('user_abc', true);
    expect(s1.identityProvider).toEqual({ status: 'synced' });
    await svc.unsuspend(actor('u2', 'ADMIN'), 'u1', now);
    expect(clerk.setBanned).toHaveBeenLastCalledWith('user_abc', false);
  });

  it('keeps the local suspension when Clerk fails', async () => {
    const { svc, clerk, rows } = setup([
      { role: 'STUDENT', clerkId: 'user_abc' } as Partial<UserRow>,
      { role: 'ADMIN' },
    ]);
    clerk.setBanned.mockResolvedValueOnce({
      status: 'failed',
      error: 'HTTP 500',
    } as never);
    const res = await svc.suspend(actor('u2', 'ADMIN'), 'u1', 'spam', now);
    expect(res.after.status).toBe('suspended');
    expect(rows[0].suspendedAt).toEqual(now);
    expect(res.identityProvider).toEqual({
      status: 'failed',
      error: 'HTTP 500',
    });
    // A thrown error is contained too.
    clerk.setBanned.mockRejectedValueOnce(new Error('boom'));
    const un = await svc.unsuspend(actor('u2', 'ADMIN'), 'u1', now);
    expect(un.after.status).toBe('active');
    expect(un.identityProvider).toEqual({ status: 'failed', error: 'boom' });
  });
});
