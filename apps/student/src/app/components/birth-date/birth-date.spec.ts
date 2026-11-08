import { TestBed } from '@angular/core/testing';
import { MeClient } from '@codify/api-client';
import {
  AgeGateService,
  birthDateFromParts,
  datePartOrder,
  monthNames,
  showBirthDateGate,
} from './birth-date';

describe('date-of-birth helpers', () => {
  it('orders the fields the way each locale writes dates', () => {
    expect(datePartOrder('pt-BR')).toEqual(['day', 'month', 'year']);
    expect(datePartOrder('en-US')).toEqual(['month', 'day', 'year']);
  });

  it('names the months in the locale', () => {
    expect(monthNames('en-US')[0]).toBe('January');
    expect(monthNames('pt-BR')[2]).toBe('março');
    expect(monthNames('en-US')).toHaveLength(12);
  });

  const now = new Date('2026-11-08T12:00:00Z');
  it('builds YYYY-MM-DD from the parts', () => {
    expect(
      birthDateFromParts({ day: '5', month: '3', year: '2011' }, now, 'UTC'),
    ).toEqual({ value: '2011-03-05' });
  });

  it('names what is wrong, like the API', () => {
    const f = (day: string, month: string, year: string) =>
      birthDateFromParts({ day, month, year }, now, 'UTC');
    expect(f('', '3', '2011')).toEqual({ problem: 'incomplete' });
    expect(f('5', '', '2011')).toEqual({ problem: 'incomplete' });
    expect(f('5', '3', '11')).toEqual({ problem: 'incomplete' });
    expect(f('31', '4', '2011')).toEqual({ problem: 'invalid' });
    expect(f('9', '11', '2026')).toEqual({ problem: 'future' });
    expect(f('1', '1', '1890')).toEqual({ problem: 'too_old' });
  });
});

describe('showBirthDateGate (one-time blocking prompt)', () => {
  const base = {
    birthDate: null as string | null | undefined,
    onboarded: true as boolean | undefined,
    onToday: false,
    todayOnboarding: 'none' as const,
  };
  it('blocks only a known missing date', () => {
    expect(showBirthDateGate(base)).toBe(true);
    expect(showBirthDateGate({ ...base, birthDate: '1990-01-01' })).toBe(false);
    expect(showBirthDateGate({ ...base, birthDate: undefined })).toBe(false);
  });

  it('lets first-run onboarding on Today ask first', () => {
    const fresh = { ...base, onboarded: false, onToday: true };
    expect(showBirthDateGate({ ...fresh, todayOnboarding: 'pending' })).toBe(
      false,
    );
    expect(showBirthDateGate({ ...fresh, todayOnboarding: 'onboarding' })).toBe(
      false,
    );
    // Today decided there is no onboarding: the prompt shows.
    expect(showBirthDateGate({ ...fresh, todayOnboarding: 'none' })).toBe(true);
    // Elsewhere in the app, or an onboarded account: always.
    expect(
      showBirthDateGate({
        ...fresh,
        onToday: false,
        todayOnboarding: 'pending',
      }),
    ).toBe(true);
    expect(
      showBirthDateGate({ ...base, onToday: true, todayOnboarding: 'pending' }),
    ).toBe(true);
  });
});

describe('AgeGateService', () => {
  function setup(me: () => Promise<unknown>) {
    TestBed.configureTestingModule({
      providers: [{ provide: MeClient, useValue: { me: jest.fn(me) } }],
    });
    return {
      gate: TestBed.inject(AgeGateService),
      client: TestBed.inject(MeClient) as unknown as { me: jest.Mock },
    };
  }

  it('loads the state once per user', async () => {
    const { gate, client } = setup(async () => ({
      birthDate: '2011-06-15',
      ageGroup: 'minor',
      onboardedAt: null,
    }));
    await gate.load('u1');
    await gate.load('u1');
    expect(client.me).toHaveBeenCalledTimes(1);
    expect(gate.birthDate()).toBe('2011-06-15');
    expect(gate.isMinor()).toBe(true);
    expect(gate.onboarded()).toBe(false);
    gate.todayOnboarding.set('none');
    await gate.load('u2');
    expect(client.me).toHaveBeenCalledTimes(2);
    expect(gate.todayOnboarding()).toBe('pending');
  });

  it('stays unknown offline (no prompt) and retries later', async () => {
    let fail = true;
    const { gate } = setup(async () => {
      if (fail) throw new Error('offline');
      return { birthDate: null, ageGroup: null, onboardedAt: 'x' };
    });
    await gate.load('u1');
    expect(gate.birthDate()).toBeUndefined();
    fail = false;
    await gate.load('u1');
    expect(gate.birthDate()).toBeNull();
    expect(gate.onboarded()).toBe(true);
  });

  it('ignores an older API without the field, and resets', async () => {
    const { gate } = setup(async () => ({ onboardedAt: null }));
    await gate.load('u1');
    expect(gate.birthDate()).toBeUndefined();
    gate.accept({ birthDate: null, ageGroup: null, onboardedAt: null });
    expect(gate.birthDate()).toBeNull();
    gate.reset();
    expect(gate.birthDate()).toBeUndefined();
    expect(gate.ageGroup()).toBeUndefined();
  });
});
