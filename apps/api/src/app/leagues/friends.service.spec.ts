import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FriendsService } from './friends.service.js';

function setup() {
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async () => ({
        email: 'me@x.io',
        displayName: 'Me',
      })),
      findFirst: jest.fn(async () => null as unknown),
    },
    friendship: {
      findUnique: jest.fn(async () => null as unknown),
      upsert: jest.fn(() => 'upsert'),
    },
    friendRequest: {
      findFirst: jest.fn(async () => null as unknown),
      create: jest.fn(async () => ({ id: 'r1' })),
      updateMany: jest.fn(() => 'updateMany'),
    },
    friendNudge: {
      findFirst: jest.fn(async () => null as unknown),
      create: jest.fn(async () => ({})),
    },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(
      async (arg: unknown): Promise<unknown> =>
        typeof arg === 'function'
          ? (arg as (t: unknown) => unknown)(self)
          : arg,
    ),
  };
  const self: unknown = prisma;
  const push = { sendToUser: jest.fn(async () => ({ sent: 1 })) };
  const referrals = {
    getOrCreateCode: jest.fn(async () => 'ABCD1234'),
    shareUrl: (c: string) => `https://codify.app/r/${c}`,
  };
  return {
    svc: new FriendsService(prisma as never, push as never, referrals as never),
    prisma,
    push,
  };
}

describe('FriendsService.sendRequest (no email enumeration)', () => {
  it('returns the same response whether or not the email exists', async () => {
    const a = setup();
    const unknown = await a.svc.sendRequest('me', 'nobody@x.io');
    expect(a.prisma.friendRequest.create).not.toHaveBeenCalled();

    const b = setup();
    b.prisma.user.findFirst.mockResolvedValueOnce({ id: 'them' });
    const known = await b.svc.sendRequest('me', 'Them@X.io ');
    expect(b.prisma.friendRequest.create).toHaveBeenCalled();
    expect(known).toEqual(unknown);
    expect(known).toEqual({ status: 'sent' });
  });

  it('already friends / pending also look identical', async () => {
    const a = setup();
    a.prisma.user.findFirst.mockResolvedValueOnce({ id: 'them' });
    a.prisma.friendship.findUnique.mockResolvedValueOnce({});
    expect(await a.svc.sendRequest('me', 'them@x.io')).toEqual({
      status: 'sent',
    });
  });

  it('self-request is rejected without a lookup', async () => {
    const a = setup();
    await expect(a.svc.sendRequest('me', 'ME@x.io')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(a.prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('FriendsService invite links', () => {
  it('GET invite reuses the referral code', async () => {
    const { svc } = setup();
    expect(await svc.invite('me')).toEqual({
      code: 'ABCD1234',
      url: 'https://codify.app/r/ABCD1234',
    });
  });

  it('accept creates the friendship once, resolves pending requests, rejects self/unknown', async () => {
    const { svc, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'owner',
      displayName: 'Owner',
    });
    const res = await svc.acceptInvite('me', 'abcd1234');
    expect(res).toEqual({
      status: 'accepted',
      friend: { userId: 'owner', displayName: 'Owner' },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { referralCode: 'ABCD1234', deletedAt: null },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(['upsert', 'updateMany']);

    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'owner',
      displayName: 'Owner',
    });
    prisma.friendship.findUnique.mockResolvedValueOnce({});
    expect((await svc.acceptInvite('me', 'ABCD1234')).status).toBe(
      'already_friends',
    );

    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'me',
      displayName: 'Me',
    });
    await expect(svc.acceptInvite('me', 'MINE')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.acceptInvite('me', 'NOPE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('FriendsService.nudge', () => {
  it('records the nudge under a lock and pushes the friend', async () => {
    const { svc, prisma, push } = setup();
    prisma.friendship.findUnique.mockResolvedValueOnce({});
    const res = await svc.nudge('me', 'friend');
    expect(res).toEqual({ status: 'nudged', pushed: true });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(push.sendToUser).toHaveBeenCalledWith(
      'friend',
      expect.any(Function),
    );
    const build = (push.sendToUser.mock.calls[0] as unknown[])[1] as (u: {
      locale: string;
    }) => { kind: string; title: string };
    expect(build({ locale: 'pt-BR' }).kind).toBe('FRIEND_NUDGE');
    expect(build({ locale: 'pt-BR' }).title).toContain('Me');
  });

  it('enforces one nudge per friend per 24h', async () => {
    const { svc, prisma, push } = setup();
    prisma.friendship.findUnique.mockResolvedValueOnce({});
    prisma.friendNudge.findFirst.mockResolvedValueOnce({ id: 'n1' });
    await expect(svc.nudge('me', 'friend')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});
