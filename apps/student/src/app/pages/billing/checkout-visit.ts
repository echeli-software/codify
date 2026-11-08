import type { PaymentMethod, PlanPrice } from '@codify/api-client';
import { supportsPrepay } from '../shared/plan-view.js';

type Track = (name: string, props: Record<string, unknown>) => void;
type Period = PlanPrice['period'];

/**
 * A BRL price on which the web checkout offers card only (PIX and Boleto
 * are BRL-annual only, docs/09 §4) — i.e. a BRL monthly price.
 */
export function cardOnlyBrl(
  price: Pick<PlanPrice, 'period' | 'currency'>,
  native: boolean,
): boolean {
  return (
    !native && price.currency.toUpperCase() === 'BRL' && !supportsPrepay(price)
  );
}

function newVisitId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One visit to the subscription page, for the monthly-PIX drop-off funnel
 * (docs/09 §4, docs/10 §14): `checkout_method_unavailable` when a BRL
 * monthly checkout shows "card only", `visitId` on `checkout_start`, and
 * `subscription_page_exit` when the visit ends without a checkout.
 */
export class CheckoutVisit {
  readonly visitId: string;
  private lastPeriod: Period | null = null;
  private lastMethodSeen: PaymentMethod | 'store' | null = null;
  private cardOnlySeen = false;
  private started = false;
  private ended = false;

  constructor(
    private readonly track: Track,
    visitId = newVisitId(),
  ) {
    this.visitId = visitId;
  }

  /** The plans toggle (monthly / annual) changed. */
  periodShown(period: Period): void {
    this.lastPeriod = period;
  }

  /** The checkout sheet opened on a price. */
  checkoutShown(
    planId: string,
    price: Pick<PlanPrice, 'period' | 'currency'>,
    native: boolean,
  ): void {
    this.lastPeriod = price.period;
    this.lastMethodSeen = native ? 'store' : 'card';
    if (!cardOnlyBrl(price, native)) return;
    this.cardOnlySeen = true;
    this.track('checkout_method_unavailable', {
      visitId: this.visitId,
      planId,
      period: price.period,
      currency: price.currency.toUpperCase(),
      method: 'pix',
    });
  }

  /** A payment method was picked in the sheet (ignored before one opened). */
  methodPicked(method: PaymentMethod): void {
    if (this.lastMethodSeen !== null && this.lastMethodSeen !== 'store')
      this.lastMethodSeen = method;
  }

  /** Props to merge into `checkout_start`; marks the visit converted. */
  checkoutStarted(): { visitId: string } {
    this.started = true;
    return { visitId: this.visitId };
  }

  /** Page left (route change, tab closed): once, and only without a checkout. */
  end(): void {
    if (this.ended || this.started) return;
    this.ended = true;
    this.track('subscription_page_exit', {
      visitId: this.visitId,
      lastPeriod: this.lastPeriod,
      lastMethodSeen: this.lastMethodSeen,
      cardOnlySeen: this.cardOnlySeen,
    });
  }
}
