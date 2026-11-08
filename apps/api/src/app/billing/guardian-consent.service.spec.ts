import { ForbiddenException } from '@nestjs/common';
import { guardianNoticeEmail } from './guardian-consent-email.js';
import {
  GUARDIAN_CONSENT_MAX_PER_DAY,
  GuardianConsentService,
  type GuardianConsentDto,
} from './guardian-consent.service.js';

const now = new Date('2026-11-08T12:00:00Z');
const MINOR = new Date('2011-06-15T00:00:00Z'); // 15
const ADULT = new Date('1990-01-01T00:00:00Z');

const dto: GuardianConsentDto = {
  planPriceId: 'price-1',
  guardianName: '  Maria   Souza ',
  guardianEmail: 'Maria@Example.com',
  confirmed: true,
};
const meta = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' };

function setup(birthDate: Date | null, locale = 'pt-BR') {
  const consents: Array<Record<string, unknown>> = [];
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        birthDate,
        timezone: 'America/Sao_Paulo',
        email: 'bia@example.com',
        displayName: 'Bia',
        locale,
      })),
    },
    planPrice: {
      findUnique: jest.fn(async () => ({
        id: 'price-1',
        isActive: true,
        currency: 'BRL',
        amountCents: 29900,
        period: 'ANNUAL',
        plan: { name: 'Pro', isActive: true, deletedAt: null },
      })),
    },
    guardianConsent: {
      count: jest.fn(async () => consents.length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `gc-${consents.length + 1}`, ...data };
        consents.push(row);
        return row;
      }),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { planPriceId: string; confirmedAt: { gte: Date } };
        }) =>
          consents.find(
            (c) =>
              c['planPriceId'] === where.planPriceId &&
              (c['confirmedAt'] as Date) >= where.confirmedAt.gte,
          ) ?? null,
      ),
    },
  };
  const email = {
    sendNotice: jest.fn(async (..._args: unknown[]) => ({ id: 'e1' })),
  };
  const svc = new GuardianConsentService(prisma as never, email as never);
  return { svc, prisma, email, consents };
}

describe('GuardianConsentService — checkout gate', () => {
  it('lets adults through without a confirmation', async () => {
    await expect(
      setup(ADULT).svc.assertCheckoutAllowed('u1', 'price-1', now),
    ).resolves.toBeUndefined();
  });

  it('refuses a minor without a recent confirmation (GUARDIAN_CONSENT_REQUIRED)', async () => {
    const err = await setup(MINOR)
      .svc.assertCheckoutAllowed('u1', 'price-1', now)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({
      code: 'GUARDIAN_CONSENT_REQUIRED',
      planPriceId: 'price-1',
    });
  });

  it('refuses an account with no date of birth (BIRTH_DATE_REQUIRED)', async () => {
    await expect(
      setup(null).svc.assertCheckoutAllowed('u1', 'price-1', now),
    ).rejects.toMatchObject({ response: { code: 'BIRTH_DATE_REQUIRED' } });
  });

  it('accepts a confirmation for that price within 24 h only', async () => {
    const { svc } = setup(MINOR);
    await svc.record('u1', dto, meta, now);
    await expect(
      svc.assertCheckoutAllowed('u1', 'price-1', now),
    ).resolves.toBeUndefined();
    await expect(
      svc.assertCheckoutAllowed('u1', 'price-2', now),
    ).rejects.toMatchObject({
      response: { code: 'GUARDIAN_CONSENT_REQUIRED' },
    });
    const later = new Date(now.getTime() + 24 * 3_600_000 + 1);
    await expect(
      svc.assertCheckoutAllowed('u1', 'price-1', later),
    ).rejects.toMatchObject({
      response: { code: 'GUARDIAN_CONSENT_REQUIRED' },
    });
  });

  it('reports the status for the subscription page', async () => {
    const { svc } = setup(MINOR);
    await expect(svc.status('u1', 'price-1', now)).resolves.toEqual({
      required: true,
      ageGroup: 'minor',
      consent: null,
    });
    await svc.record('u1', dto, meta, now);
    await expect(svc.status('u1', 'price-1', now)).resolves.toMatchObject({
      required: false,
      consent: {
        guardianName: 'Maria Souza',
        validUntil: '2026-11-09T12:00:00.000Z',
      },
    });
    await expect(
      setup(ADULT).svc.status('u1', 'price-1', now),
    ).resolves.toEqual({ required: false, ageGroup: 'adult', consent: null });
  });
});

describe('GuardianConsentService.record', () => {
  it('stores name, email, IP and UA, and emails the guardian in the student’s locale', async () => {
    const { svc, prisma, email } = setup(MINOR, 'pt-BR');
    const res = await svc.record('u1', dto, meta, now);
    expect(res).toMatchObject({
      id: 'gc-1',
      planPriceId: 'price-1',
      guardianName: 'Maria Souza',
      noticeSent: true,
    });
    expect(prisma.guardianConsent.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        guardianName: 'Maria Souza',
        guardianEmail: 'maria@example.com',
        purpose: 'web_checkout',
        planPriceId: 'price-1',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        confirmedAt: now,
      },
    });
    const [to, message] = email.sendNotice.mock.calls[0] as [
      string,
      { subject: string; text: string; html: string },
    ];
    expect(to).toBe('maria@example.com');
    expect(message.subject).toContain('Confirmação de responsável');
    expect(message.text).toContain('Bia');
    expect(message.text).toContain('Pro');
    expect(message.html).toContain('lang="pt-BR"');
  });

  it('keeps the confirmation when the notice fails', async () => {
    const { svc, email } = setup(MINOR);
    email.sendNotice.mockRejectedValueOnce(new Error('provider down'));
    await expect(svc.record('u1', dto, meta, now)).resolves.toMatchObject({
      noticeSent: false,
    });
  });

  it('refuses adults, unknown ages, the student’s own email and unknown prices', async () => {
    await expect(
      setup(ADULT).svc.record('u1', dto, meta, now),
    ).rejects.toMatchObject({
      response: { code: 'GUARDIAN_CONSENT_NOT_NEEDED' },
    });
    await expect(
      setup(null).svc.record('u1', dto, meta, now),
    ).rejects.toMatchObject({ response: { code: 'BIRTH_DATE_REQUIRED' } });
    await expect(
      setup(MINOR).svc.record(
        'u1',
        { ...dto, guardianEmail: 'BIA@example.com' },
        meta,
        now,
      ),
    ).rejects.toMatchObject({
      response: { code: 'GUARDIAN_EMAIL_IS_STUDENT' },
    });
    const s = setup(MINOR);
    s.prisma.planPrice.findUnique.mockResolvedValueOnce(null as never);
    await expect(s.svc.record('u1', dto, meta, now)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('limits confirmations per day (each one emails someone)', async () => {
    const { svc } = setup(MINOR);
    for (let i = 0; i < GUARDIAN_CONSENT_MAX_PER_DAY; i++)
      await svc.record('u1', dto, meta, now);
    await expect(svc.record('u1', dto, meta, now)).rejects.toMatchObject({
      response: { code: 'GUARDIAN_CONSENT_RATE_LIMITED' },
    });
  });
});

describe('guardianNoticeEmail', () => {
  it('renders en-US with the price and escapes names', () => {
    const m = guardianNoticeEmail({
      locale: 'en-US',
      guardianName: 'Jo <b>',
      studentName: 'Sam',
      planName: 'Pro',
      currency: 'usd',
      amountCents: 999,
      period: 'MONTHLY',
    });
    expect(m.subject).toBe('Parent or guardian confirmation: Sam on Codify');
    expect(m.text).toContain('$9.99 per month');
    expect(m.html).toContain('Jo &lt;b&gt;');
    expect(m.html).not.toContain('Jo <b>');
    expect(m.html).toContain('lang="en-US"');
  });

  it('renders pt-BR annual prices', () => {
    const m = guardianNoticeEmail({
      locale: 'pt-BR',
      guardianName: 'Maria',
      studentName: 'Bia',
      planName: 'Pro',
      currency: 'BRL',
      amountCents: 29900,
      period: 'ANNUAL',
    });
    expect(m.text).toMatch(/R\$\s?299,00 por ano/);
  });
});
