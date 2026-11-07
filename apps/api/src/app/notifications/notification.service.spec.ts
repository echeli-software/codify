import type { EmailService } from '../email/email.service.js';
import { NotificationService } from './notification.service.js';
import type { PushService } from './push.service.js';

const NOW = new Date('2026-10-07T15:00:00Z');

function setup(user: Record<string, unknown> | null = {}) {
  const created: { data: Record<string, unknown> }[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        user === null
          ? null
          : {
              email: 'ana@example.com',
              displayName: 'Ana',
              locale: 'pt-BR',
              deletedAt: null,
              suspendedAt: null,
              dormantAt: null,
              notificationPrefs: [],
              ...user,
            },
      ),
    },
    notification: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return { id: `row-${created.length}` };
      }),
    },
  };
  const push = {
    sendToUser: jest.fn(async () => ({
      status: 'sent',
      sent: 1,
      failed: 0,
      pruned: 0,
    })),
  };
  const email = {
    mode: 'dev',
    send: jest.fn(async () => ({ id: 'email-1' })),
  };
  const svc = new NotificationService(
    prisma as never,
    push as unknown as PushService,
    email as unknown as EmailService,
  );
  return { svc, prisma, push, email, created };
}

describe('NotificationService.notify', () => {
  it('always writes the inbox row with the kind default deep link + action', async () => {
    const { svc, created } = setup();
    const res = await svc.notify(
      'u1',
      ({ locale }) => ({
        kind: 'LEAGUE_RESULT',
        title: locale,
        body: 'b',
      }),
      { now: NOW },
    );
    expect(res.inAppId).toBe('row-1');
    expect(created[0].data).toMatchObject({
      userId: 'u1',
      channel: 'IN_APP',
      kind: 'LEAGUE_RESULT',
      payload: {
        title: 'pt-BR',
        body: 'b',
        deepLink: '/league',
        action: { type: 'open_league' },
      },
      sentAt: NOW,
    });
  });

  it('pushes push kinds with url / kind / notificationId in the data', async () => {
    const { svc, push, email } = setup();
    await svc.notify(
      'u1',
      {
        kind: 'FRIEND_NUDGE',
        title: 't',
        body: 'b',
        deepLink: '/friends',
        data: { senderId: 's1' },
      },
      { now: NOW },
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      'u1',
      {
        kind: 'FRIEND_NUDGE',
        title: 't',
        body: 'b',
        data: {
          senderId: 's1',
          kind: 'FRIEND_NUDGE',
          url: '/friends',
          notificationId: 'row-1',
        },
      },
      expect.objectContaining({ kind: 'FRIEND_NUDGE', now: NOW }),
    );
    expect(email.send).not.toHaveBeenCalled();
  });

  it('rejects unsafe deep links (falls back to the kind default)', async () => {
    const { svc, created } = setup();
    await svc.notify('u1', {
      kind: 'ITEM_DROP',
      title: 't',
      body: 'b',
      deepLink: 'https://evil.example/x',
    });
    expect((created[0].data['payload'] as { deepLink: string }).deepLink).toBe(
      '/shop',
    );
  });

  it('emails email kinds and logs the EMAIL row; no push for WELCOME', async () => {
    const { svc, push, email, created } = setup();
    const res = await svc.notify(
      'u1',
      ({ displayName }) => ({
        kind: 'WELCOME',
        title: `Hi ${displayName}`,
        body: 'b',
      }),
      { now: NOW },
    );
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        to: 'ana@example.com',
        locale: 'pt-BR',
        kind: 'WELCOME',
        title: 'Hi Ana',
        deepLink: '/today',
      }),
    );
    expect(res.email).toEqual({ status: 'sent', id: 'email-1' });
    expect(created[1].data).toMatchObject({
      channel: 'EMAIL',
      kind: 'WELCOME',
      sentAt: NOW,
      payload: expect.objectContaining({ providerId: 'email-1' }),
    });
  });

  it("respects the kind's emailEnabled, except for locked kinds", async () => {
    const off = setup({
      notificationPrefs: [
        { kind: 'WEEKLY_RECAP', emailEnabled: false },
        { kind: 'BILLING', emailEnabled: false },
      ],
    });
    expect(
      (
        await off.svc.notify('u1', {
          kind: 'WEEKLY_RECAP',
          title: 't',
          body: 'b',
        })
      ).email,
    ).toEqual({ status: 'disabled' });
    expect(
      (await off.svc.notify('u1', { kind: 'BILLING', title: 't', body: 'b' }))
        .email.status,
    ).toBe('sent');
  });

  it('dormant users only get BILLING push/email (inbox still written)', async () => {
    const { svc, push, email } = setup({ dormantAt: new Date() });
    const promo = await svc.notify('u1', {
      kind: 'REACTIVATION',
      title: 't',
      body: 'b',
    });
    expect(promo.inAppId).toBe('row-1');
    expect(promo.push).toEqual({ status: 'dormant' });
    expect(promo.email).toEqual({ status: 'dormant' });
    expect(push.sendToUser).not.toHaveBeenCalled();
    const billing = await svc.notify('u1', {
      kind: 'BILLING',
      title: 't',
      body: 'b',
    });
    expect(billing.push.status).toBe('sent');
    expect(billing.email.status).toBe('sent');
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('skips placeholder addresses and survives provider failures', async () => {
    const placeholder = setup({ email: 'user_1@users.clerk.invalid' });
    expect(
      (
        await placeholder.svc.notify('u1', {
          kind: 'WELCOME',
          title: 't',
          body: 'b',
        })
      ).email,
    ).toEqual({ status: 'no_address' });

    const failing = setup();
    failing.email.send.mockRejectedValueOnce(new Error('503'));
    failing.push.sendToUser.mockRejectedValueOnce(new Error('fcm down'));
    const res = await failing.svc.notify('u1', {
      kind: 'BILLING',
      title: 't',
      body: 'b',
    });
    expect(res).toMatchObject({
      status: 'ok',
      push: { status: 'error' },
      email: { status: 'error' },
    });
  });

  it('channel options narrow delivery', async () => {
    const { svc, push, email } = setup();
    await svc.notify(
      'u1',
      { kind: 'REACTIVATION', title: 't', body: 'b' },
      { channels: { push: false } },
    );
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a missing or deleted user', async () => {
    expect(
      (
        await setup(null).svc.notify('u1', {
          kind: 'SYSTEM',
          title: 't',
          body: 'b',
        })
      ).status,
    ).toBe('user_not_found');
    const deleted = setup({ deletedAt: new Date() });
    expect(
      (
        await deleted.svc.notify('u1', {
          kind: 'SYSTEM',
          title: 't',
          body: 'b',
        })
      ).status,
    ).toBe('user_not_found');
    expect(deleted.prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe('NotificationService.sendToUser (PushService-shaped, billing)', () => {
  it('routes through notify: inbox deep link from data, channels hint, push outcome', async () => {
    const { svc, created, email } = setup();
    const res = await svc.sendToUser(
      'u1',
      ({ locale }) => ({
        title: locale,
        body: 'b',
        data: { type: 'billing_payment_received', route: '/subscription' },
        channels: { push: false },
      }),
      { kind: 'BILLING' },
    );
    expect(res).toEqual({ status: 'not_requested' });
    expect(created[0].data).toMatchObject({
      kind: 'BILLING',
      payload: expect.objectContaining({ deepLink: '/subscription' }),
    });
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('returns the push result for a push-capable kind', async () => {
    const { svc } = setup();
    expect(
      (
        await svc.sendToUser(
          'u1',
          { title: 't', body: 'b' },
          { kind: 'BILLING' },
        )
      ).status,
    ).toBe('sent');
  });
});
