import { Prisma } from '@prisma/client';
import {
  PROMO_FAILURES_PER_HOUR,
  PromoCodesService,
  isRedeemableNow,
  normalizePromoCode,
} from './promo-codes.service.js';

const NOW = new Date('2026-11-07T12:00:00Z');

function code(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    code: 'WELCOME50',
    coins: 50,
    maxRedemptions: null as number | null,
    redemptions: 0,
    startsAt: null as Date | null,
    endsAt: null as Date | null,
    isActive: true,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function setup(row: ReturnType<typeof code> | null, failures = 0) {
  const redemptions = new Set<string>();
  const failuresLog: string[] = [];
  const tx = {
    promoCodeRedemption: {
      create: jest.fn(
        async ({ data }: { data: { promoCodeId: string; userId: string } }) => {
          const k = `${data.promoCodeId}|${data.userId}`;
          if (redemptions.has(k))
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: '7',
            });
          redemptions.add(k);
          return data;
        },
      ),
    },
    promoCode: {
      updateMany: jest.fn(
        async ({ where }: { where: { redemptions?: { lt: number } } }) => {
          if (!row) return { count: 0 };
          if (where.redemptions && row.redemptions >= where.redemptions.lt)
            return { count: 0 };
          row.redemptions += 1;
          return { count: 1 };
        },
      ),
    },
  };
  const prisma = {
    idempotencyRecord: {
      count: jest.fn(async () => failures),
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        failuresLog.push(data.key);
        return data;
      }),
    },
    promoCode: {
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        row && row.code === where.code ? row : null,
      ),
      create: jest.fn(async ({ data }: { data: object }) => ({
        ...code(),
        ...data,
      })),
    },
    promoCodeRedemption: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            promoCodeId_userId: { promoCodeId: string; userId: string };
          };
        }) =>
          redemptions.has(
            `${where.promoCodeId_userId.promoCodeId}|${where.promoCodeId_userId.userId}`,
          )
            ? { promoCodeId: 'p1' }
            : null,
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const gamification = {
    grantReward: jest.fn(async (p: { baseCoins: number }) => ({
      coins: p.baseCoins,
      totals: { totalXp: 0, coins: p.baseCoins, level: 1 },
    })),
  };
  const svc = new PromoCodesService(prisma as never, gamification as never);
  return { svc, prisma, gamification, failuresLog, row };
}

const codeOf = (err: unknown) =>
  (err as { getResponse(): { code: string } }).getResponse().code;
const statusOf = (err: unknown) => (err as { getStatus(): number }).getStatus();

describe('PromoCodesService.redeem', () => {
  it('is case-insensitive and grants a PROMO_CODE ledger row once', async () => {
    const { svc, gamification } = setup(code());
    const res = await svc.redeem('u1', '  welcome50 ', NOW);
    expect(res).toMatchObject({ code: 'WELCOME50', coins: 50 });
    expect(gamification.grantReward).toHaveBeenCalledWith(
      expect.objectContaining({
        coinSource: 'PROMO_CODE',
        baseCoins: 50,
        idempotencyKey: 'promo_code:p1:u1',
        uncapped: true,
      }),
      expect.anything(),
    );
    const again = await svc.redeem('u1', 'WELCOME50', NOW).catch((e) => e);
    expect(codeOf(again)).toBe('PROMO_CODE_ALREADY_REDEEMED');
    expect(statusOf(again)).toBe(409);
  });

  it('respects the window and the redemption limit', async () => {
    const early = setup(code({ startsAt: new Date('2026-12-01') }));
    expect(
      codeOf(await early.svc.redeem('u1', 'WELCOME50', NOW).catch((e) => e)),
    ).toBe('PROMO_CODE_NOT_STARTED');
    const late = setup(code({ endsAt: new Date('2026-11-01') }));
    const err = await late.svc.redeem('u1', 'WELCOME50', NOW).catch((e) => e);
    expect([codeOf(err), statusOf(err)]).toEqual(['PROMO_CODE_EXPIRED', 410]);
    const full = setup(code({ maxRedemptions: 1, redemptions: 1 }));
    expect(
      codeOf(await full.svc.redeem('u2', 'WELCOME50', NOW).catch((e) => e)),
    ).toBe('PROMO_CODE_EXHAUSTED');
  });

  it('unknown / inactive codes are 404 and count as failed attempts', async () => {
    const { svc, failuresLog } = setup(code({ isActive: false }));
    const err = await svc.redeem('u1', 'WELCOME50', NOW).catch((e) => e);
    expect([codeOf(err), statusOf(err)]).toEqual(['PROMO_CODE_NOT_FOUND', 404]);
    await svc.redeem('u1', 'x!', NOW).catch(() => undefined);
    expect(failuresLog).toHaveLength(2);
  });

  it('rate-limits after 10 failed attempts in an hour', async () => {
    const { svc } = setup(code(), PROMO_FAILURES_PER_HOUR);
    const err = await svc.redeem('u1', 'WELCOME50', NOW).catch((e) => e);
    expect([codeOf(err), statusOf(err)]).toEqual([
      'PROMO_CODE_RATE_LIMITED',
      429,
    ]);
  });
});

describe('promo code helpers', () => {
  it('normalizes and evaluates availability', () => {
    expect(normalizePromoCode(' abc-1 ')).toBe('ABC-1');
    expect(isRedeemableNow(code() as never, NOW)).toBe(true);
    expect(
      isRedeemableNow(
        code({ maxRedemptions: 2, redemptions: 2 }) as never,
        NOW,
      ),
    ).toBe(false);
  });

  it('admin create stores the code upper-case and rejects a bad window', async () => {
    const { svc, prisma } = setup(null);
    await svc.create({ code: 'spring', coins: 20 });
    expect(prisma.promoCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'SPRING' }),
      }),
    );
    await expect(
      svc.create({
        code: 'x1x',
        coins: 1,
        startsAt: '2026-11-10T00:00:00Z',
        endsAt: '2026-11-09T00:00:00Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'PROMO_CODE_WINDOW' } });
  });
});
