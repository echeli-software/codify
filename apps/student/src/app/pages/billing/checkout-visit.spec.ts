import { CheckoutVisit, cardOnlyBrl } from './checkout-visit';

const brlMonthly = { period: 'MONTHLY' as const, currency: 'brl' };
const brlAnnual = { period: 'ANNUAL' as const, currency: 'BRL' };
const usdMonthly = { period: 'MONTHLY' as const, currency: 'USD' };

describe('cardOnlyBrl', () => {
  it('is true only for a BRL monthly price on the web', () => {
    expect(cardOnlyBrl(brlMonthly, false)).toBe(true);
    expect(cardOnlyBrl(brlAnnual, false)).toBe(false);
    expect(cardOnlyBrl(usdMonthly, false)).toBe(false);
    expect(cardOnlyBrl(brlMonthly, true)).toBe(false);
  });
});

describe('CheckoutVisit', () => {
  const setup = () => {
    const track = jest.fn();
    return { track, visit: new CheckoutVisit(track, 'visit-1') };
  };

  it('reports card only on a BRL monthly checkout', () => {
    const { track, visit } = setup();
    visit.checkoutShown('p1', brlMonthly, false);
    expect(track).toHaveBeenCalledWith('checkout_method_unavailable', {
      visitId: 'visit-1',
      planId: 'p1',
      period: 'MONTHLY',
      currency: 'BRL',
      method: 'pix',
    });
  });

  it('stays quiet on prices that offer PIX, other currencies and native', () => {
    const { track, visit } = setup();
    visit.checkoutShown('p1', brlAnnual, false);
    visit.checkoutShown('p1', usdMonthly, false);
    visit.checkoutShown('p1', brlMonthly, true);
    expect(track).not.toHaveBeenCalled();
  });

  it('sends one exit with the last period and method seen', () => {
    const { track, visit } = setup();
    visit.periodShown('MONTHLY');
    visit.checkoutShown('p1', brlMonthly, false);
    visit.periodShown('ANNUAL');
    visit.checkoutShown('p1', brlAnnual, false);
    visit.methodPicked('pix');
    visit.end();
    visit.end();
    const exits = track.mock.calls.filter(
      (c) => c[0] === 'subscription_page_exit',
    );
    expect(exits).toEqual([
      [
        'subscription_page_exit',
        {
          visitId: 'visit-1',
          lastPeriod: 'ANNUAL',
          lastMethodSeen: 'pix',
          cardOnlySeen: true,
        },
      ],
    ]);
  });

  it('a started checkout tags the event and suppresses the exit', () => {
    const { track, visit } = setup();
    visit.checkoutShown('p1', brlMonthly, false);
    expect(visit.checkoutStarted()).toEqual({ visitId: 'visit-1' });
    visit.end();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('exit before any checkout sheet carries nulls', () => {
    const { track, visit } = setup();
    visit.end();
    expect(track).toHaveBeenCalledWith('subscription_page_exit', {
      visitId: 'visit-1',
      lastPeriod: null,
      lastMethodSeen: null,
      cardOnlySeen: false,
    });
  });

  it('generates a visit id when none is given', () => {
    const a = new CheckoutVisit(jest.fn());
    const b = new CheckoutVisit(jest.fn());
    expect(a.visitId).toBeTruthy();
    expect(a.visitId).not.toBe(b.visitId);
  });
});
