import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InboxService, kindView, toInboxItem } from './inbox.service.js';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  channel: 'IN_APP',
  kind: 'FRIEND_NUDGE',
  payload: {
    title: 'Hi',
    body: 'b',
    deepLink: '/friends',
    action: { type: 'nudge_back', ref: 'f1' },
  },
  scheduledFor: null,
  sentAt: new Date('2026-10-07T12:00:00Z'),
  readAt: null,
  createdAt: new Date('2026-10-07T12:00:00Z'),
  ...over,
});

function setup() {
  const prefs = new Map<string, Record<string, unknown>>();
  const prisma = {
    notification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...row('n1'),
        ...data,
      })),
      updateMany: jest.fn(async () => ({ count: 3 })),
      count: jest.fn(async () => 2),
    },
    notificationPreference: {
      findUnique: jest.fn(
        async ({ where }: { where: { userId_kind: { kind: string } } }) =>
          prefs.get(where.userId_kind.kind) ?? null,
      ),
      upsert: jest.fn(
        async (args: {
          where: { userId_kind: { kind: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const k = args.where.userId_kind.kind;
          const next = prefs.has(k)
            ? { ...prefs.get(k), ...args.update }
            : args.create;
          prefs.set(k, next);
          return next;
        },
      ),
    },
    user: {
      findUnique: jest.fn(async () => ({
        pushDailyCap: null,
        pushWeeklyOptIn: false,
        reminderMinute: null,
        notificationPrefs: [...prefs.values()],
      })),
      update: jest.fn(async () => ({})),
    },
  };
  const db = {
    ...prisma,
    $transaction: jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        fn(prisma),
    ),
  };
  return { svc: new InboxService(db as never), prisma, prefs };
}

describe('InboxService', () => {
  it('pages newest first with an id cursor', async () => {
    const { svc, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([
      row('c'),
      row('b'),
      row('a'),
    ]);
    const page = await svc.list('u1', undefined, 2);
    expect(page.items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(page.nextCursor).toBe('b');
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', channel: 'IN_APP' },
      orderBy: { id: 'desc' },
      take: 3,
    });

    prisma.notification.findMany.mockResolvedValueOnce([row('a')]);
    const next = await svc.list('u1', 'b', 2);
    expect(next).toMatchObject({ nextCursor: null });
    expect(prisma.notification.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', channel: 'IN_APP', id: { lt: 'b' } },
      }),
    );
  });

  it("only touches the caller's own rows (404 otherwise)", async () => {
    const { svc, prisma } = setup();
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(svc.markRead('u2', 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.fewer('u2', 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u2', channel: 'IN_APP' },
    });
  });

  it('marks read once (idempotent) and all unread at once', async () => {
    const { svc, prisma } = setup();
    prisma.notification.findFirst.mockResolvedValueOnce(row('n1'));
    expect((await svc.markRead('u1', 'n1')).readAt).not.toBeNull();
    const read = new Date();
    prisma.notification.findFirst.mockResolvedValueOnce(
      row('n1', { readAt: read }),
    );
    expect((await svc.markRead('u1', 'n1')).readAt).toBe(read.toISOString());
    expect(prisma.notification.update).toHaveBeenCalledTimes(1);
    expect(await svc.markAllRead('u1')).toEqual({ updated: 3 });
  });

  it('"fewer like this" bumps the kind up to 2 and refuses locked kinds', async () => {
    const { svc, prisma } = setup();
    prisma.notification.findFirst.mockResolvedValue(row('n1'));
    expect(await svc.fewer('u1', 'n1')).toEqual({
      kind: 'FRIEND_NUDGE',
      fewerLevel: 1,
    });
    expect((await svc.fewer('u1', 'n1')).fewerLevel).toBe(2);
    expect((await svc.fewer('u1', 'n1')).fewerLevel).toBe(2);

    prisma.notification.findFirst.mockResolvedValue(
      row('n2', { kind: 'BILLING' }),
    );
    await expect(svc.fewer('u1', 'n2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fills preference defaults (PROMO push off, locked kinds)', async () => {
    const { svc } = setup();
    const view = await svc.preferences('u1');
    expect(view.kinds).toHaveLength(11);
    expect(view.kinds.find((k) => k.kind === 'PROMO')).toMatchObject({
      pushEnabled: false,
      emailEnabled: true,
      locked: false,
    });
    expect(view.kinds.find((k) => k.kind === 'BILLING')).toMatchObject({
      locked: true,
      channels: { push: true, email: true },
    });
    expect(view.kinds.find((k) => k.kind === 'WEEKLY_RECAP')?.channels).toEqual(
      { push: false, email: true },
    );
  });

  it('updates user fields and merges partial kind updates', async () => {
    const { svc, prisma, prefs } = setup();
    prefs.set('ITEM_DROP', {
      kind: 'ITEM_DROP',
      pushEnabled: true,
      emailEnabled: false,
      fewerLevel: 1,
    });
    await svc.updatePreferences('u1', {
      pushDailyCap: null,
      reminderMinute: 1200,
      kinds: [{ kind: 'ITEM_DROP', pushEnabled: false }],
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { pushDailyCap: null, reminderMinute: 1200 },
    });
    expect(prefs.get('ITEM_DROP')).toMatchObject({
      pushEnabled: false,
      emailEnabled: false,
      fewerLevel: 1,
    });
  });

  it('rejects disabling locked kinds and duplicate kinds', async () => {
    const { svc } = setup();
    await expect(
      svc.updatePreferences('u1', {
        kinds: [{ kind: 'SYSTEM', pushEnabled: false }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'NOTIFICATION_KIND_LOCKED' },
    });
    await expect(
      svc.updatePreferences('u1', {
        kinds: [{ kind: 'PROMO' }, { kind: 'PROMO' }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'NOTIFICATION_KIND_DUPLICATE' },
    });
  });
});

describe('toInboxItem / kindView', () => {
  it('reads the payload defensively', () => {
    expect(
      toInboxItem(row('x', { payload: { title: 1, action: 'bad' } }) as never),
    ).toMatchObject({ title: '', body: '', deepLink: null, action: null });
  });

  it('locked kinds always read as on', () => {
    expect(
      kindView('SYSTEM', {
        pushEnabled: false,
        emailEnabled: false,
        fewerLevel: 2,
      }),
    ).toMatchObject({ pushEnabled: true, emailEnabled: true, locked: true });
  });
});
