import type { NotificationPreferences } from '@codify/api-client';
import {
  cloneForm,
  diffForm,
  minutesToTime,
  timeToMinutes,
  toForm,
} from './prefs-form';

const prefs = (): NotificationPreferences => ({
  pushDailyCap: null,
  pushWeeklyOptIn: false,
  reminderMinute: null,
  kinds: [
    {
      kind: 'ITEM_DROP',
      pushEnabled: true,
      emailEnabled: true,
      fewerLevel: 1,
      locked: false,
      channels: { push: true, email: false },
    },
    {
      kind: 'WEEKLY_RECAP',
      pushEnabled: true,
      emailEnabled: true,
      fewerLevel: 0,
      locked: false,
      channels: { push: false, email: true },
    },
    {
      kind: 'BILLING',
      pushEnabled: true,
      emailEnabled: true,
      fewerLevel: 0,
      locked: true,
      channels: { push: true, email: true },
    },
  ],
});

const me = { quietHoursStart: null, quietHoursEnd: null };

describe('time helpers', () => {
  it('converts minutes ↔ HH:MM', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1439)).toBe('23:59');
    expect(minutesToTime(1200)).toBe('20:00');
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('8:05')).toBe(485);
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(undefined)).toBeNull();
  });
});

describe('toForm', () => {
  it('fills defaults: auto reminder at 20:00, quiet 22:00–08:00, default cap', () => {
    const f = toForm(prefs(), me);
    expect(f).toMatchObject({
      dailyCap: 'default',
      weeklyOptIn: false,
      reminderMode: 'auto',
      reminderTime: '20:00',
      quietStart: '22:00',
      quietEnd: '08:00',
    });
    const custom = toForm(
      { ...prefs(), pushDailyCap: 0, reminderMinute: 435 },
      { quietHoursStart: 1380, quietHoursEnd: 420 },
    );
    expect(custom).toMatchObject({
      dailyCap: '0',
      reminderMode: 'custom',
      reminderTime: '07:15',
      quietStart: '23:00',
      quietEnd: '07:00',
    });
  });
});

describe('diffForm', () => {
  it('sends nothing when nothing changed', () => {
    const f = toForm(prefs(), me);
    expect(diffForm(f, cloneForm(f))).toEqual({
      prefs: null,
      me: null,
      changedKinds: [],
      invalid: false,
    });
  });

  it('sends only the changed fields and kinds', () => {
    const o = toForm(prefs(), me);
    const f = cloneForm(o);
    f.dailyCap = '4';
    f.reminderMode = 'custom';
    f.reminderTime = '18:45';
    f.kinds[0].pushEnabled = false;
    f.kinds[0].fewerLevel = 0;
    f.kinds[1].emailEnabled = false;
    f.quietStart = '21:30';
    const c = diffForm(o, f);
    expect(c.prefs).toEqual({
      pushDailyCap: 4,
      reminderMinute: 1125,
      kinds: [
        { kind: 'ITEM_DROP', pushEnabled: false, fewerLevel: 0 },
        { kind: 'WEEKLY_RECAP', emailEnabled: false },
      ],
    });
    expect(c.me).toEqual({ quietHoursStart: 1290, quietHoursEnd: 480 });
    expect(c.changedKinds).toEqual([
      { kind: 'ITEM_DROP', channel: 'push', enabled: false },
      { kind: 'WEEKLY_RECAP', channel: 'email', enabled: false },
    ]);
  });

  it('resets to server defaults with null (cap, automatic reminder)', () => {
    const o = toForm({ ...prefs(), pushDailyCap: 3, reminderMinute: 600 }, me);
    const f = { ...o, dailyCap: 'default', reminderMode: 'auto' as const };
    expect(diffForm(o, f).prefs).toEqual({
      pushDailyCap: null,
      reminderMinute: null,
    });
  });

  it('never sends locked kinds and flags invalid times', () => {
    const o = toForm(prefs(), me);
    const f = cloneForm(o);
    f.kinds[2].emailEnabled = false;
    expect(diffForm(o, f).prefs).toBeNull();
    f.quietEnd = '';
    expect(diffForm(o, f).invalid).toBe(true);
    const g = {
      ...cloneForm(o),
      reminderMode: 'custom' as const,
      reminderTime: '',
    };
    expect(diffForm(o, g).invalid).toBe(true);
  });
});
