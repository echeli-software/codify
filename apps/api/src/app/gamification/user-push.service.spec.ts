import type {
  NotificationService,
  NotifyContent,
  NotifyResult,
} from '../notifications/notification.service.js';
import { UserPushService } from './user-push.service.js';

function setup(result: Partial<NotifyResult> | Error) {
  const notify = jest.fn(
    async (
      _userId: string,
      build: (u: { locale: string; displayName: string }) => NotifyContent,
    ): Promise<NotifyResult> => {
      build({ locale: 'pt-BR', displayName: 'Ana' });
      if (result instanceof Error) throw result;
      return {
        status: 'ok',
        inAppId: 'n1',
        push: { status: 'sent', sent: 1, failed: 0, pruned: 0 },
        email: { status: 'not_requested' },
        ...result,
      };
    },
  );
  const svc = new UserPushService({
    notify,
  } as unknown as NotificationService);
  return { svc, notify };
}

const built = (notify: jest.Mock) => {
  const build = notify.mock.calls[0][1] as (u: {
    locale: string;
    displayName: string;
  }) => NotifyContent;
  return build({ locale: 'en-US', displayName: 'Ana' });
};

describe('UserPushService → NotificationService', () => {
  it('routes the message through notify (inbox + push) with type, deep link and locale copy', async () => {
    const { svc, notify } = setup({});
    const res = await svc.sendToUser('u1', ({ locale }) => ({
      kind: 'LEAGUE_RESULT',
      title: locale === 'en-US' ? 'Promoted' : 'Promovido',
      body: 'b',
      data: { route: '/league', rank: '1' },
    }));
    expect(res).toEqual({ sent: 1 });
    expect(built(notify)).toEqual({
      kind: 'LEAGUE_RESULT',
      title: 'Promoted',
      body: 'b',
      deepLink: '/league',
      data: { route: '/league', rank: '1', type: 'league_result' },
    });
  });

  it('turns a friend nudge into a "send back a nudge" quick action', async () => {
    const { svc, notify } = setup({});
    await svc.sendToUser('u1', {
      kind: 'FRIEND_NUDGE',
      title: 't',
      body: 'b',
      data: { senderId: 'friend-1', route: '/friends' },
    });
    expect(built(notify).action).toEqual({
      type: 'nudge_back',
      ref: 'friend-1',
    });
  });

  it.each([
    [{ status: 'deferred', deliverAt: 'x' }, 'deferred'],
    [{ status: 'quiet_hours', retryAfterMinutes: 5 }, 'quiet_hours'],
    [{ status: 'capped', reason: 'weekly' }, 'capped'],
    [{ status: 'disabled' }, 'disabled'],
    [{ status: 'dormant' }, 'dormant'],
    [{ status: 'no_devices' }, 'no_devices'],
  ] as const)('maps push outcome %j → skipped %s', async (push, skipped) => {
    const { svc } = setup({ push: push as NotifyResult['push'] });
    expect(
      await svc.sendToUser('u1', { kind: 'ITEM_DROP', title: 't', body: 'b' }),
    ).toEqual({ sent: 0, skipped });
  });

  it('reports a missing user', async () => {
    const { svc } = setup({ status: 'user_not_found' });
    expect(
      await svc.sendToUser('u1', { kind: 'ITEM_DROP', title: 't', body: 'b' }),
    ).toEqual({ sent: 0, skipped: 'no_user' });
  });

  it('never throws when delivery fails', async () => {
    const { svc } = setup(new Error('boom'));
    expect(
      await svc.sendToUser('u1', { kind: 'SYSTEM', title: 't', body: 'b' }),
    ).toEqual({ sent: 0 });
  });
});
