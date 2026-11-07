import { AuthMiddleware } from '../auth/auth.middleware.js';
import type { ClerkService } from '../auth/clerk.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import type { UserLifecycleService } from './user-lifecycle.service.js';

/** The auth middleware → UserLifecycleService wiring (welcome, return from lapse). */
function setup(rows: Record<string, unknown>[]) {
  const prisma = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { clerkId?: string } }) =>
          rows.find((r) => r['clerkId'] === where.clerkId) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'new-id',
          deletedAt: null,
          deletionRequestedAt: null,
          purgedAt: null,
          suspendedAt: null,
          ...data,
        };
        rows.push(row);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const lifecycle = { onCreated: jest.fn(), onSeen: jest.fn() };
  const mw = new AuthMiddleware(
    prisma as never,
    new AppConfigService(
      parseEnv({ DATABASE_URL: 'postgres://x', ALLOW_DEV_AUTH: 'true' }),
    ),
    {} as ClerkService,
    lifecycle as unknown as UserLifecycleService,
  );
  return { mw, lifecycle };
}

const existing = (lastSeenAt: Date | null) => ({
  id: 'u1',
  clerkId: 'dev-student',
  email: 'student@codify.local',
  role: 'STUDENT',
  displayName: 'Maria',
  lastSeenAt,
  deletedAt: null,
  deletionRequestedAt: null,
  purgedAt: null,
  suspendedAt: null,
});

describe('AuthMiddleware lifecycle hooks', () => {
  it('a freshly provisioned user triggers the welcome', async () => {
    const { mw, lifecycle } = setup([]);
    await mw.resolve('dev-token-student');
    expect(lifecycle.onCreated).toHaveBeenCalledWith('new-id');
    expect(lifecycle.onSeen).not.toHaveBeenCalled();
  });

  it('the periodic lastSeenAt refresh reports the previous lastSeenAt', async () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    const { mw, lifecycle } = setup([existing(old)]);
    await mw.resolve('dev-token-student');
    expect(lifecycle.onCreated).not.toHaveBeenCalled();
    expect(lifecycle.onSeen).toHaveBeenCalledWith(
      { id: 'u1', lastSeenAt: old },
      expect.any(Date),
    );
  });

  it('no hook inside the 5-minute refresh interval', async () => {
    const { mw, lifecycle } = setup([existing(new Date())]);
    await mw.resolve('dev-token-student');
    expect(lifecycle.onSeen).not.toHaveBeenCalled();
  });
});
