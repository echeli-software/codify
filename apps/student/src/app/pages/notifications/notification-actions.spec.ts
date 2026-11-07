import type { InboxNotification } from '@codify/api-client';
import { openRoute, quickAction, safeRoute } from './notification-actions';

const base: InboxNotification = {
  id: 'n1',
  kind: 'DAILY_QUEST',
  title: 't',
  body: 'b',
  deepLink: '/today',
  action: { type: 'open_daily_quest' },
  createdAt: '2026-11-07T10:00:00Z',
  readAt: null,
};

describe('quickAction', () => {
  it('maps known actions to translated labels + routes', () => {
    expect(quickAction(base)).toEqual({
      kind: 'navigate',
      labelKey: 'student.notifications.actions.open_daily_quest',
      route: '/today',
    });
    expect(
      quickAction({
        ...base,
        kind: 'LEAGUE_RESULT',
        deepLink: '/league',
        action: { type: 'open_league' },
      }),
    ).toMatchObject({ route: '/league' });
  });

  it('keeps a more specific deep link of the same page (win-back offer)', () => {
    expect(
      quickAction({
        ...base,
        kind: 'REACTIVATION',
        deepLink: '/subscription?offer=winback',
        action: { type: 'open_subscription' },
      }),
    ).toMatchObject({ route: '/subscription?offer=winback' });
    // A deep link to another page never overrides the action's route.
    expect(
      quickAction({
        ...base,
        deepLink: '/shop',
        action: { type: 'open_league' },
      }),
    ).toMatchObject({ route: '/league' });
  });

  it('turns nudge_back into a nudge of the sender', () => {
    expect(
      quickAction({
        ...base,
        kind: 'FRIEND_NUDGE',
        action: { type: 'nudge_back', ref: 'f1' },
      }),
    ).toEqual({
      kind: 'nudge',
      labelKey: 'student.notifications.actions.nudge_back',
      friendId: 'f1',
    });
    expect(quickAction({ ...base, action: { type: 'nudge_back' } })).toBeNull();
  });

  it('ignores unknown or missing actions', () => {
    expect(quickAction({ ...base, action: null })).toBeNull();
    expect(
      quickAction({ ...base, action: { type: 'format_disk' } }),
    ).toBeNull();
  });
});

describe('safeRoute / openRoute', () => {
  it('only follows in-app paths', () => {
    expect(safeRoute('/league')).toBe('/league');
    expect(safeRoute('https://evil.example')).toBeNull();
    expect(safeRoute('//evil.example')).toBeNull();
    expect(safeRoute('javascript:alert(1)')).toBeNull();
    expect(safeRoute(null)).toBeNull();
    expect(openRoute({ ...base, deepLink: '/friends' })).toBe('/friends');
  });
});
