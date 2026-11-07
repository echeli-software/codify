import {
  accountBlockFor,
  accountStatus,
  purgeAt,
  restorableUntil,
  type AccountLifecycle,
} from './account-state.js';

const DAY = 86_400_000;
const now = new Date('2026-11-07T12:00:00Z');
const life = (over: Partial<AccountLifecycle> = {}): AccountLifecycle => ({
  deletedAt: null,
  deletionRequestedAt: null,
  purgedAt: null,
  suspendedAt: null,
  ...over,
});

describe('account-state', () => {
  it('restorableUntil: 14 days after a self-service deletion only', () => {
    const at = new Date(now.getTime() - 3 * DAY);
    expect(
      restorableUntil(life({ deletedAt: at, deletionRequestedAt: at }), now),
    ).toEqual(new Date(at.getTime() + 14 * DAY));
    const old = new Date(now.getTime() - 14 * DAY - 1);
    expect(
      restorableUntil(life({ deletedAt: old, deletionRequestedAt: old }), now),
    ).toBeNull();
    expect(restorableUntil(life({ deletedAt: at }), now)).toBeNull();
    expect(
      restorableUntil(
        life({ deletedAt: at, deletionRequestedAt: at, purgedAt: now }),
        now,
      ),
    ).toBeNull();
  });

  it('purgeAt is 30 days after deletedAt', () => {
    expect(purgeAt(life({ deletedAt: now }))).toEqual(
      new Date(now.getTime() + 30 * DAY),
    );
    expect(purgeAt(life())).toBeNull();
  });

  it('status: suspension wins over deletion', () => {
    expect(accountStatus(life())).toBe('active');
    expect(accountStatus(life({ deletedAt: now }))).toBe('deleted');
    expect(accountStatus(life({ deletedAt: now, suspendedAt: now }))).toBe(
      'suspended',
    );
  });

  it('accountBlockFor: allow-list per state, any one-segment global prefix', () => {
    expect(accountBlockFor(life(), 'GET', '/api/today', now)).toBeNull();
    const deleted = life({ deletedAt: now, deletionRequestedAt: now });
    expect(
      accountBlockFor(deleted, 'GET', '/api/me/account-status', now),
    ).toBeNull();
    expect(
      accountBlockFor(deleted, 'GET', '/me/account-status/', now),
    ).toBeNull();
    expect(accountBlockFor(deleted, 'POST', '/api/me/restore', now)).toBeNull();
    expect(
      accountBlockFor(deleted, 'POST', '/api/x/me/restore', now),
    ).toMatchObject({
      code: 'ACCOUNT_DELETED',
    });
    expect(accountBlockFor(deleted, 'PATCH', '/api/me', now)).toMatchObject({
      code: 'ACCOUNT_DELETED',
      restorableUntil: new Date(now.getTime() + 14 * DAY).toISOString(),
    });
    const suspended = life({ suspendedAt: now });
    expect(
      accountBlockFor(suspended, 'GET', '/api/me/account-status', now),
    ).toBeNull();
    expect(
      accountBlockFor(suspended, 'POST', '/api/me/restore', now),
    ).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    });
  });
});
