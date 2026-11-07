import { Prisma } from '@prisma/client';
import type { NotificationService } from '../notifications/notification.service.js';
import { UserLifecycleService } from './user-lifecycle.service.js';
import type { WelcomeBackQuest } from './welcome-back-quest.js';

function setup(user: Record<string, unknown> | null = null) {
  const claimed = new Set<string>();
  const state = user ? { ...user } : null;
  const prisma = {
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (claimed.has(data.key))
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        claimed.add(data.key);
        return data;
      }),
    },
    user: {
      findUnique: jest.fn(async () => (state ? { ...state } : null)),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { reactivationStage: number };
          data: Record<string, unknown>;
        }) => {
          if (!state || state['reactivationStage'] !== where.reactivationStage)
            return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        },
      ),
    },
  };
  const notifications = { notify: jest.fn(async () => ({ status: 'ok' })) };
  const welcomeBack = { assign: jest.fn(async () => true) };
  const svc = new UserLifecycleService(
    prisma as never,
    notifications as unknown as NotificationService,
    welcomeBack as unknown as WelcomeBackQuest,
  );
  return { svc, notifications, welcomeBack, state };
}

describe('UserLifecycleService', () => {
  it('sends WELCOME once per user (inbox + email copy by locale)', async () => {
    const { svc, notifications } = setup();
    expect(await svc.welcome('u1')).toBe(true);
    expect(await svc.welcome('u1')).toBe(false);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const build = (notifications.notify.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
      displayName: string;
    }) => { kind: string; title: string };
    expect(build({ locale: 'en-US', displayName: 'Ana' })).toMatchObject({
      kind: 'WELCOME',
      title: 'Welcome to Codify, Ana!',
    });
  });

  it('a return after a 14+ day lapse resets the stage and assigns the welcome-back quest', async () => {
    const { svc, welcomeBack, state } = setup({
      reactivationStage: 30,
      dormantAt: null,
      timezone: 'America/Sao_Paulo',
      locale: 'pt-BR',
    });
    expect(await svc.returned('u1')).toBe(true);
    expect(state).toMatchObject({ reactivationStage: 0, dormantAt: null });
    expect(welcomeBack.assign).toHaveBeenCalledWith(
      'u1',
      'America/Sao_Paulo',
      'pt-BR',
      expect.any(Date),
    );
    // Second call: nothing left to reset.
    expect(await svc.returned('u1')).toBe(false);
    expect(welcomeBack.assign).toHaveBeenCalledTimes(1);
  });

  it('a day-7 return resets without a quest; a dormant return clears dormantAt', async () => {
    const seven = setup({
      reactivationStage: 7,
      dormantAt: null,
      timezone: null,
      locale: 'en-US',
    });
    await seven.svc.returned('u1');
    expect(seven.state?.['reactivationStage']).toBe(0);
    expect(seven.welcomeBack.assign).not.toHaveBeenCalled();

    const dormant = setup({
      reactivationStage: 90,
      dormantAt: new Date(),
      timezone: null,
      locale: 'en-US',
    });
    await dormant.svc.returned('u1');
    expect(dormant.state).toMatchObject({
      reactivationStage: 0,
      dormantAt: null,
    });
    expect(dormant.welcomeBack.assign).toHaveBeenCalled();
  });

  it('onSeen: first-ever request → welcome; recent activity → no work', async () => {
    const { svc, notifications } = setup({
      reactivationStage: 0,
      dormantAt: null,
    });
    svc.onSeen({ id: 'u1', lastSeenAt: null });
    await new Promise((r) => setImmediate(r));
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    svc.onSeen({ id: 'u1', lastSeenAt: new Date(Date.now() - 3600_000) });
    await new Promise((r) => setImmediate(r));
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
});
