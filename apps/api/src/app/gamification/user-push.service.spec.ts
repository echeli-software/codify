import { PushService } from '../notifications/push.service.js';
import { UserPushService } from './user-push.service.js';

describe('UserPushService.sendToUser', () => {
  const makeUser = (over: Record<string, unknown> = {}) => ({
    locale: 'en-US',
    timezone: 'UTC',
    quietHoursStart: null,
    quietHoursEnd: null,
    deletedAt: null,
    deviceTokens: [{ token: 't1' }, { token: 'invalid-x' }],
    ...over,
  });
  const setup = (user: unknown) => {
    const prisma = {
      user: { findUnique: jest.fn(async () => user) },
      deviceToken: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    };
    const push = {
      mode: 'dev' as const,
      send: jest.fn(async (msgs: { token: string }[]) => ({
        sent: msgs.length - 1,
        failed: 1,
        invalidTokens: ['invalid-x'],
      })),
    };
    const pushService = new PushService(prisma as never, push);
    return { svc: new UserPushService(pushService), prisma, push, pushService };
  };
  const noon = new Date('2026-10-07T12:00:00Z');

  it('sends to every device, builds copy from locale, prunes invalid tokens', async () => {
    const { svc, push, prisma } = setup(makeUser());
    const res = await svc.sendToUser(
      'u1',
      ({ locale }) => ({ kind: 'FRIEND_NUDGE', title: locale, body: 'b' }),
      noon,
    );
    expect(res.sent).toBe(1);
    const msgs = push.send.mock.calls[0][0] as unknown as {
      title: string;
      data: Record<string, string>;
    }[];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].title).toBe('en-US');
    expect(msgs[0].data['type']).toBe('friend_nudge');
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalled();
  });

  it('skips inside quiet hours except SYSTEM', async () => {
    const night = new Date('2026-10-07T23:30:00Z');
    const { svc, push } = setup(makeUser());
    expect(
      await svc.sendToUser(
        'u1',
        { kind: 'LEAGUE_RESULT', title: 't', body: 'b' },
        night,
      ),
    ).toEqual({
      sent: 0,
      skipped: 'quiet_hours',
    });
    expect(push.send).not.toHaveBeenCalled();
    expect(
      (
        await svc.sendToUser(
          'u1',
          { kind: 'SYSTEM', title: 't', body: 'b' },
          night,
        )
      ).sent,
    ).toBe(1);
  });

  it('reports no devices / no user', async () => {
    expect(
      (
        await setup(makeUser({ deviceTokens: [] })).svc.sendToUser(
          'u1',
          { kind: 'ITEM_DROP', title: 't', body: 'b' },
          noon,
        )
      ).skipped,
    ).toBe('no_devices');
    expect(
      (
        await setup(null).svc.sendToUser(
          'u1',
          { kind: 'ITEM_DROP', title: 't', body: 'b' },
          noon,
        )
      ).skipped,
    ).toBe('no_user');
  });

  it('never throws when the provider fails', async () => {
    const { svc, push } = setup(makeUser());
    push.send.mockRejectedValueOnce(new Error('fcm down'));
    await expect(
      svc.sendToUser('u1', { kind: 'ITEM_DROP', title: 't', body: 'b' }, noon),
    ).resolves.toEqual({ sent: 0 });
  });
});

describe('UserPushService → PushService delivery rules', () => {
  const user = {
    locale: 'pt-BR',
    timezone: 'UTC',
    quietHoursStart: null,
    quietHoursEnd: null,
    deletedAt: null,
    deviceTokens: [{ token: 't1' }],
  };
  const noon = new Date('2026-10-07T12:00:00Z');

  function withPushResult(result: Record<string, unknown>) {
    const pushService = {
      sendToUser: jest.fn(async () => result),
    } as unknown as PushService;
    return { svc: new UserPushService(pushService), pushService };
  }

  it('maps deferred / capped results to skipped reasons', async () => {
    expect(
      await withPushResult({
        status: 'deferred',
        deliverAt: '2026-10-08T08:00:00.000Z',
      }).svc.sendToUser('u1', { kind: 'LEAGUE_RESULT', title: 't', body: 'b' }),
    ).toEqual({ sent: 0, skipped: 'deferred' });
    expect(
      await withPushResult({
        status: 'capped',
        reason: 'daily',
      }).svc.sendToUser('u1', { kind: 'ITEM_DROP', title: 't', body: 'b' }),
    ).toEqual({ sent: 0, skipped: 'capped' });
  });

  it('passes the kind through so SYSTEM bypasses the rules, and stamps data.type', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => user) },
      deviceToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    const provider = {
      mode: 'dev' as const,
      send: jest.fn(async (msgs: unknown[]) => ({
        sent: msgs.length,
        failed: 0,
        invalidTokens: [],
      })),
    };
    const pushService = new PushService(prisma as never, provider);
    const spy = jest.spyOn(pushService, 'sendToUser');
    const svc = new UserPushService(pushService);
    await svc.sendToUser(
      'u1',
      ({ locale }) => ({ kind: 'SYSTEM', title: locale, body: 'b' }),
      noon,
    );
    const content = spy.mock.calls[0][1] as (u: { locale: string }) => {
      kind: string;
      data: Record<string, string>;
    };
    expect(content({ locale: 'pt-BR' })).toMatchObject({
      kind: 'SYSTEM',
      data: { type: 'system' },
    });
    expect(provider.send).toHaveBeenCalledWith([
      { token: 't1', title: 'pt-BR', body: 'b', data: { type: 'system' } },
    ]);
  });
});
