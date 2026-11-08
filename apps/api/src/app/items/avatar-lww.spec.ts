import { avatarWriteTime, isStaleWrite } from './avatar-lww.js';

describe('avatar last-write-wins', () => {
  const now = new Date('2026-11-08T12:00:00Z');

  it('uses the client time when given, never a future one', () => {
    expect(avatarWriteTime('2026-11-08T11:00:00Z', now).toISOString()).toBe(
      '2026-11-08T11:00:00.000Z',
    );
    expect(avatarWriteTime(null, now)).toBe(now);
    expect(avatarWriteTime('2026-11-09T00:00:00Z', now)).toBe(now);
    expect(avatarWriteTime('garbage', now)).toBe(now);
  });

  it('a write older than the stored change is stale', () => {
    const at = new Date('2026-11-08T11:00:00Z');
    expect(isStaleWrite(at, new Date('2026-11-08T11:30:00Z'))).toBe(true);
    expect(isStaleWrite(at, new Date('2026-11-08T10:30:00Z'))).toBe(false);
    expect(isStaleWrite(at, null)).toBe(false);
  });
});
