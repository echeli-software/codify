import {
  UserPushService,
  inQuietHours,
  localMinutes,
} from './user-push.service.js';

describe('quiet hours', () => {
  it('default window 22:00–08:00 wraps midnight', () => {
    expect(inQuietHours(23 * 60, null, null)).toBe(true);
    expect(inQuietHours(3 * 60, null, null)).toBe(true);
    expect(inQuietHours(8 * 60, null, null)).toBe(false);
    expect(inQuietHours(12 * 60, null, null)).toBe(false);
  });
  it('custom non-wrapping window and disabled window', () => {
    expect(inQuietHours(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(inQuietHours(15 * 60, 12 * 60, 14 * 60)).toBe(false);
    expect(inQuietHours(3 * 60, 0, 0)).toBe(false);
  });
  it('localMinutes converts to the user zone', () => {
    expect(
      localMinutes(new Date('2026-10-07T15:30:00Z'), 'America/Sao_Paulo'),
    ).toBe(12 * 60 + 30);
    expect(localMinutes(new Date('2026-10-07T15:30:00Z'), 'Not/AZone')).toBe(
      15 * 60 + 30,
    );
  });
});

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
    return { svc: new UserPushService(prisma as never, push), prisma, push };
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
