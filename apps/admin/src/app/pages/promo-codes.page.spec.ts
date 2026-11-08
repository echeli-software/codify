import { promoCodeBody, validatePromoCode } from './promo-codes.page';

const draft = (over = {}) => ({
  code: 'spring-50',
  coins: 50 as number | string,
  maxRedemptions: null as number | string | null,
  startsAt: null as string | null,
  endsAt: null as string | null,
  isActive: true,
  description: '',
  ...over,
});

describe('promo code form', () => {
  it('accepts a valid draft and builds an upper-case body', () => {
    expect(validatePromoCode(draft(), true)).toEqual({});
    expect(promoCodeBody(draft({ maxRedemptions: '' }))).toMatchObject({
      code: 'SPRING-50',
      coins: 50,
      maxRedemptions: null,
      description: null,
    });
    expect(promoCodeBody(draft({ maxRedemptions: '10' })).maxRedemptions).toBe(
      10,
    );
  });

  it('lists every problem', () => {
    expect(
      validatePromoCode(
        draft({
          code: 'a',
          coins: 0,
          maxRedemptions: '-1',
          startsAt: '2026-11-10T10:00',
          endsAt: '2026-11-09T10:00',
        }),
        true,
      ),
    ).toEqual({
      code: 'admin.promoCodes.invalidCode',
      coins: 'admin.promoCodes.invalidCoins',
      maxRedemptions: 'admin.common.invalidNumber',
      endsAt: 'admin.promoCodes.invalidWindow',
    });
    // The code is fixed when editing.
    expect(validatePromoCode(draft({ code: '!' }), false)).toEqual({});
    expect(validatePromoCode(draft({ coins: 10_001 }), false)).toHaveProperty(
      'coins',
    );
  });
});
