import { UnderAgeDeletionService } from './under-age-deletion.service.js';

const now = new Date('2026-11-08T12:00:00Z');

function setup() {
  const calls: string[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ clerkId: 'user_abc' })),
      updateMany: jest.fn(async () => {
        calls.push('mark');
        return { count: 1 };
      }),
    },
  };
  const billing = {
    stopAutoRenewForUser: jest.fn(async () => {
      calls.push('billing');
      return { stopped: [], store: [] };
    }),
  };
  const purge = {
    purgeUser: jest.fn(async () => {
      calls.push('purge');
      return true;
    }),
  };
  const clerk = {
    deleteUser: jest.fn(async () => {
      calls.push('clerk');
      return { status: 'synced' as const };
    }),
  };
  const svc = new UnderAgeDeletionService(
    prisma as never,
    billing as never,
    purge as never,
    clerk as never,
  );
  return { svc, prisma, billing, purge, clerk, calls };
}

describe('UnderAgeDeletionService', () => {
  it('stops renewals, marks the account non-restorable, purges now, deletes at Clerk', async () => {
    const { svc, prisma, purge, clerk, calls } = setup();
    const res = await svc.deleteNow('u1', now);
    expect(res).toEqual({
      purged: true,
      identityProvider: { status: 'synced' },
    });
    expect(calls).toEqual(['billing', 'mark', 'purge', 'clerk']);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', purgedAt: null },
      // No deletionRequestedAt → never restorable; the date goes too.
      data: { deletedAt: now, deletionRequestedAt: null, birthDate: null },
    });
    expect(purge.purgeUser).toHaveBeenCalledWith('u1', now);
    // The Clerk id is read before the purge overwrites it.
    expect(clerk.deleteUser).toHaveBeenCalledWith('user_abc');
  });

  it('still deletes when stopping the renewals fails', async () => {
    const { svc, billing, purge } = setup();
    billing.stopAutoRenewForUser.mockRejectedValueOnce(
      new Error('stripe down'),
    );
    await svc.deleteNow('u1', now);
    expect(purge.purgeUser).toHaveBeenCalled();
  });

  it('returns (does not throw) a Clerk failure', async () => {
    const { svc, clerk } = setup();
    clerk.deleteUser.mockResolvedValueOnce({
      status: 'failed',
      error: 'HTTP 500',
    } as never);
    await expect(svc.deleteNow('u1', now)).resolves.toMatchObject({
      identityProvider: { status: 'failed' },
    });
  });
});
