import type { Plan, PlanPrice } from '@codify/api-client';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** View-model for `<cdf-plan-card>` built from an API plan. */
export interface PlanCardView {
  id: string;
  name: string;
  description: string | null;
  priceId: string;
  amountCents: number;
  currency: string;
  period: 'monthly' | 'annual';
  installments: number | null;
  features: string[];
  highlight: boolean;
  trialLabel: string | null;
}

/** Active prices, monthly first, then annual. */
export function activePrices(plan: Pick<Plan, 'prices'>): PlanPrice[] {
  return plan.prices
    .filter((p) => p.isActive)
    .sort((a, b) =>
      a.period === b.period ? 0 : a.period === 'MONTHLY' ? -1 : 1,
    );
}

/** Headline price for a plan card: the monthly one when there is one. */
export function headlinePrice(plan: Pick<Plan, 'prices'>): PlanPrice | null {
  return activePrices(plan)[0] ?? null;
}

/**
 * Annual savings vs. 12 × the monthly price of the same plan and currency,
 * as a 0–1 fraction (null when there is nothing to compare).
 */
export function annualSavings(
  plan: Pick<Plan, 'prices'>,
  annual: PlanPrice,
): number | null {
  if (annual.period !== 'ANNUAL') return null;
  const monthly = plan.prices.find(
    (p) =>
      p.isActive && p.period === 'MONTHLY' && p.currency === annual.currency,
  );
  if (!monthly || monthly.amountCents <= 0) return null;
  const frac = 1 - annual.amountCents / (monthly.amountCents * 12);
  return frac > 0.005 ? frac : null;
}

/** PIX / Boleto are one-shot annual BRL prepay only (docs/09 §4, API rule). */
export function supportsPrepay(
  price: Pick<PlanPrice, 'period' | 'currency'>,
): boolean {
  return price.period === 'ANNUAL' && price.currency.toUpperCase() === 'BRL';
}

export function planCardView(plan: Plan, t: Translate): PlanCardView | null {
  const price = headlinePrice(plan);
  if (!price) return null;
  const features: string[] = [];
  if (plan.tagline) features.push(plan.tagline);
  features.push(
    t(
      plan.isAllAccess
        ? 'student.plans.allCourses'
        : 'student.plans.someCourses',
      {
        count: plan.categoryIds.length,
      },
    ),
  );
  features.push(t('student.plans.xpBoost'));
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceId: price.id,
    amountCents: price.amountCents,
    currency: price.currency,
    period: price.period === 'ANNUAL' ? 'annual' : 'monthly',
    installments:
      price.period === 'ANNUAL' && (price.maxInstallments ?? 0) > 1
        ? price.maxInstallments
        : null,
    features,
    highlight: plan.isAllAccess,
    trialLabel:
      plan.trialDays > 0
        ? t('student.plans.trialDays', { count: plan.trialDays })
        : null,
  };
}

/** A `<cdf-paywall-sheet>` plan row (`id` is the plan *price* id). */
export interface PaywallPlanRow {
  id: string;
  name: string;
  cadence: 'monthly' | 'yearly';
  priceLabel: string;
  badge?: string | null;
  highlight?: boolean;
}

/**
 * Paywall rows for the plans that unlock some content: the API's
 * `requiredPlans` ids (402 body) or plans-including-this-course, each
 * active price formatted with `formatPrice` for the user's locale.
 */
export function paywallRows(
  plans: readonly Plan[],
  requiredIds: readonly string[] | null,
  format: (price: PlanPrice, plan: Plan) => string,
  t: Translate,
): PaywallPlanRow[] {
  const wanted =
    requiredIds && requiredIds.length ? new Set(requiredIds) : null;
  return plans
    .filter((p) => p.isActive && (!wanted || wanted.has(p.id)))
    .flatMap((plan) =>
      activePrices(plan).map((price) => {
        const savings = annualSavings(plan, price);
        return {
          id: price.id,
          name: plan.name,
          cadence:
            price.period === 'ANNUAL'
              ? ('yearly' as const)
              : ('monthly' as const),
          priceLabel: format(price, plan),
          badge: savings
            ? t('student.plans.save', { pct: Math.round(savings * 100) })
            : null,
          highlight: plan.isAllAccess,
        };
      }),
    );
}
