import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  canReceiveMarketing,
  marketingBirthDateCutoff,
} from './marketing-audience.js';
import { PromoPromptService } from './promo-prompt.service.js';

const NOW = new Date('2026-11-08T15:00:00Z');
const ADULT = new Date('1995-03-10T00:00:00Z');

describe('marketing audience (adults only, fail closed)', () => {
  it('no date of birth or under 18 → no marketing', () => {
    expect(canReceiveMarketing({ birthDate: null }, NOW)).toBe(false);
    expect(canReceiveMarketing({ birthDate: undefined }, NOW)).toBe(false);
    expect(
      canReceiveMarketing({ birthDate: new Date('2011-01-01T00:00:00Z') }, NOW),
    ).toBe(false);
    expect(canReceiveMarketing({ birthDate: new Date('x') }, NOW)).toBe(false);
    expect(canReceiveMarketing({ birthDate: ADULT }, NOW)).toBe(true);
    expect(canReceiveMarketing({ birthDate: '1995-03-10' }, NOW)).toBe(true);
  });

  it('turns 18 only once that day has started in every time zone', () => {
    // 2026-11-08 15:00Z: UTC−12 is still on 2026-11-08 03:00 → cutoff 2008-11-08.
    expect(marketingBirthDateCutoff(NOW)).toBe('2008-11-08');
    // 2026-11-08 05:00Z: UTC−12 is still on 2026-11-07.
    const early = new Date('2026-11-08T05:00:00Z');
    expect(marketingBirthDateCutoff(early)).toBe('2008-11-07');
    // Counted on the user's own day: still the 7th in Pago Pago (UTC−11).
    const pago = { birthDate: '2008-11-08', timezone: 'Pacific/Pago_Pago' };
    expect(canReceiveMarketing(pago, early)).toBe(false);
    expect(canReceiveMarketing({ ...pago, timezone: 'UTC' }, early)).toBe(true);
    // 29 February: 18 on 1 March in a common year.
    const feb28 = new Date('2026-02-28T18:00:00Z');
    expect(marketingBirthDateCutoff(feb28)).toBe('2008-02-28');
    expect(canReceiveMarketing({ birthDate: '2008-02-29' }, feb28)).toBe(false);
  });
});

function setup(
  user: Record<string, unknown> | null,
  opts: { lessons?: number; prompted?: boolean } = {},
) {
  const prefs: Record<string, unknown>[] = [];
  const users: Record<string, unknown>[] = [];
  let prompted = opts.prompted ?? false;
  const tx = {
    user: {
      updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
        if (prompted) return { count: 0 };
        prompted = true;
        users.push(args.data);
        return { count: 1 };
      }),
    },
    notificationPreference: {
      upsert: jest.fn(async (args: { create: Record<string, unknown> }) => {
        prefs.push(args.create);
        return args.create;
      }),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () =>
        user === null
          ? null
          : {
              deletedAt: null,
              promoPromptedAt: opts.prompted ? new Date(NOW) : null,
              ...user,
            },
      ),
    },
    progress: {
      findFirst: jest.fn(async () =>
        (opts.lessons ?? 1) > 0 ? { id: 'p1' } : null,
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new PromoPromptService(prisma as never, audit as never);
  return { svc, prisma, tx, audit, prefs, users };
}

const actor = { userId: 'u1', role: 'STUDENT' } as never;

describe('PromoPromptService.state', () => {
  it('shows the prompt to an adult with a completed lesson, once', async () => {
    expect(await setup({ birthDate: ADULT }).svc.state('u1', NOW)).toEqual({
      show: true,
      promptedAt: null,
    });
    expect(
      await setup({ birthDate: ADULT }, { lessons: 0 }).svc.state('u1', NOW),
    ).toMatchObject({ show: false });
    expect(
      await setup({ birthDate: ADULT }, { prompted: true }).svc.state(
        'u1',
        NOW,
      ),
    ).toEqual({ show: false, promptedAt: NOW.toISOString() });
  });

  it('never shows it to a minor or a user without a date of birth', async () => {
    for (const birthDate of [null, new Date('2012-04-01T00:00:00Z')]) {
      const { svc, prisma } = setup({ birthDate });
      expect(await svc.state('u1', NOW)).toEqual({
        show: false,
        promptedAt: null,
      });
      expect(prisma.progress.findFirst).not.toHaveBeenCalled();
    }
  });
});

describe('PromoPromptService.answer', () => {
  it('accept with email: PROMO push + email on, marketing consent, stamped', async () => {
    const { svc, prefs, users, audit } = setup({ birthDate: ADULT });
    expect(await svc.answer(actor, { push: true, email: true }, NOW)).toEqual({
      promptedAt: NOW.toISOString(),
      push: true,
      email: true,
    });
    expect(users[0]).toEqual({
      promoPromptedAt: NOW,
      marketingEmailOptIn: true,
    });
    expect(prefs[0]).toMatchObject({
      kind: 'PROMO',
      pushEnabled: true,
      emailEnabled: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        action: 'user.promo_prompt_answered',
        diff: { push: true, email: true },
      }),
    );
  });

  it('decline: stamped, PROMO push + email off, consent untouched', async () => {
    const { svc, prefs, users } = setup({ birthDate: ADULT });
    await svc.answer(actor, { push: false, email: false }, NOW);
    expect(users[0]).toEqual({ promoPromptedAt: NOW });
    expect(prefs[0]).toMatchObject({ pushEnabled: false, emailEnabled: false });
  });

  it('push without the email tick box never turns marketing email on', async () => {
    const { svc, prefs, users } = setup({ birthDate: ADULT });
    await svc.answer(actor, { push: true, email: false }, NOW);
    expect(users[0]).not.toHaveProperty('marketingEmailOptIn');
    expect(prefs[0]).toMatchObject({ pushEnabled: true, emailEnabled: false });
  });

  it('asks once: a second answer is 409 PROMO_PROMPT_ANSWERED', async () => {
    const { svc } = setup({ birthDate: ADULT }, { prompted: true });
    await expect(
      svc.answer(actor, { push: true, email: true }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('minors / unknown age: 403 PROMO_PROMPT_NOT_ALLOWED and nothing changes', async () => {
    for (const birthDate of [null, new Date('2010-01-01T00:00:00Z')]) {
      const { svc, tx } = setup({ birthDate });
      await expect(
        svc.answer(actor, { push: true, email: true }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(tx.notificationPreference.upsert).not.toHaveBeenCalled();
    }
  });
});
