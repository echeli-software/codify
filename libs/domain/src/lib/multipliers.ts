/**
 * Pure multiplier resolver — the configurable engine from
 * /docs/07-gamification.md §3. Same code runs server-side (to credit the
 * canonical reward) and client-side (to render the "why am I getting Xx?"
 * breakdown), so the math never drifts.
 *
 * Stacking rule: multiplicative across categories, but only ONE of each
 * category applies, in this order:
 *   1. PREMIUM_DEFAULT (1.0 for free users)
 *   2. STREAK_TIER     (highest qualifying tier)
 *   3. COURSE_PROMO ⊕ LESSON_PROMO (more specific wins; never both)
 *   4. CAMPAIGN        (one active)
 * The effective multiplier is capped (default 30x) to avoid surprise payouts.
 */

export type MultiplierKind =
  | 'PREMIUM_DEFAULT'
  | 'COURSE_PROMO'
  | 'LESSON_PROMO'
  | 'STREAK_TIER'
  | 'CAMPAIGN';

export type MultiplierTarget = 'XP' | 'COINS' | 'BOTH';

export const DEFAULT_MULTIPLIER_CAP = 30;

export interface MultiplierRule {
  id: string;
  kind: MultiplierKind;
  target: MultiplierTarget;
  value: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  courseId?: string | null;
  lessonId?: string | null;
  streakDaysMin?: number | null;
  description?: string | null;
}

export interface ResolveMultiplierInput {
  /** Candidate rules (typically all rows; this function filters by window). */
  multipliers: MultiplierRule[];
  isPremium: boolean;
  courseId?: string | null;
  lessonId?: string | null;
  streakDays?: number;
  now?: Date;
  cap?: number;
}

export interface MultiplierComponent {
  kind: MultiplierKind;
  value: number;
  description?: string | null;
}

export interface MultiplierBreakdown {
  effective: number;
  components: MultiplierComponent[];
  /** True when the cap clipped the product. */
  capped: boolean;
  /** The product before the cap was applied (equals `effective` unless capped). */
  uncapped: number;
}

export interface ResolvedMultipliers {
  xp: MultiplierBreakdown;
  coins: MultiplierBreakdown;
}

function ms(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

/** True when `rule`'s optional [startsAt, endsAt] window contains `now`. */
export function isMultiplierActiveAt(
  rule: Pick<MultiplierRule, 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): boolean {
  return isActive(rule, now.getTime());
}

function isActive(
  rule: Pick<MultiplierRule, 'startsAt' | 'endsAt'>,
  now: number,
): boolean {
  const s = ms(rule.startsAt);
  const e = ms(rule.endsAt);
  if (s != null && now < s) return false;
  if (e != null && now > e) return false;
  return true;
}

function appliesTo(target: MultiplierTarget, dim: 'XP' | 'COINS'): boolean {
  return target === 'BOTH' || target === dim;
}

/**
 * Resolve the effective XP and Coin multipliers + their breakdowns for a
 * reward event. Components with value 1.0 (e.g. free-user premium) are
 * omitted from the breakdown — only real boosts are listed.
 */
export function resolveMultiplier(
  input: ResolveMultiplierInput,
): ResolvedMultipliers {
  const now = (input.now ?? new Date()).getTime();
  const cap = input.cap ?? DEFAULT_MULTIPLIER_CAP;
  const streakDays = input.streakDays ?? 0;
  const active = input.multipliers.filter((m) => isActive(m, now));

  // Each "category slot" picks at most one rule.
  const chosen: MultiplierRule[] = [];

  // 1. PREMIUM_DEFAULT — only for paid users.
  if (input.isPremium) {
    const premium = pickMaxValue(
      active.filter((m) => m.kind === 'PREMIUM_DEFAULT'),
    );
    if (premium) chosen.push(premium);
  }

  // 2. STREAK_TIER — highest qualifying tier (largest streakDaysMin ≤ streakDays).
  const streakTiers = active
    .filter(
      (m) => m.kind === 'STREAK_TIER' && (m.streakDaysMin ?? 0) <= streakDays,
    )
    .sort((a, b) => (b.streakDaysMin ?? 0) - (a.streakDaysMin ?? 0));
  if (streakTiers[0]) chosen.push(streakTiers[0]);

  // 3. COURSE_PROMO ⊕ LESSON_PROMO — the more specific wins.
  const lessonPromo = input.lessonId
    ? pickMaxValue(
        active.filter(
          (m) => m.kind === 'LESSON_PROMO' && m.lessonId === input.lessonId,
        ),
      )
    : null;
  const coursePromo = input.courseId
    ? pickMaxValue(
        active.filter(
          (m) => m.kind === 'COURSE_PROMO' && m.courseId === input.courseId,
        ),
      )
    : null;
  const promo = lessonPromo ?? coursePromo;
  if (promo) chosen.push(promo);

  // 4. CAMPAIGN — one active (highest value).
  const campaign = pickMaxValue(active.filter((m) => m.kind === 'CAMPAIGN'));
  if (campaign) chosen.push(campaign);

  return {
    xp: build(chosen, 'XP', cap),
    coins: build(chosen, 'COINS', cap),
  };
}

function pickMaxValue(rules: MultiplierRule[]): MultiplierRule | null {
  if (rules.length === 0) return null;
  return rules.reduce((best, r) => (r.value > best.value ? r : best));
}

function build(
  chosen: MultiplierRule[],
  dim: 'XP' | 'COINS',
  cap: number,
): MultiplierBreakdown {
  const components: MultiplierComponent[] = [];
  let product = 1;
  for (const rule of chosen) {
    if (!appliesTo(rule.target, dim)) continue;
    if (rule.value === 1) continue; // a 1.0 boost is a no-op; don't list it
    product *= rule.value;
    components.push({
      kind: rule.kind,
      value: rule.value,
      description: rule.description,
    });
  }
  const capped = product > cap;
  const effective = round2(capped ? cap : product);
  return { effective, components, capped, uncapped: round2(product) };
}

/** Round to 2 decimals to avoid FP noise like 24.000000001. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apply an effective multiplier to a base amount, rounding to an integer.
 * Centralized so XP and coins round identically everywhere.
 */
export function applyMultiplier(base: number, effective: number): number {
  return Math.round(base * effective);
}

/** Fields an admin can set on a multiplier (create, or a patch merged onto the row). */
export interface MultiplierDraft {
  kind: MultiplierKind;
  target?: MultiplierTarget;
  value: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  courseId?: string | null;
  lessonId?: string | null;
  streakDaysMin?: number | null;
}

/** Hard ceiling on a single rule's value (the column is DECIMAL(5,2)). */
export const MAX_MULTIPLIER_VALUE = 100;

/**
 * Validate a multiplier as it will be stored (after merging a patch onto the
 * existing row). Returns human-readable problems; empty = valid.
 *   - value must be a finite number > 0 and ≤ {@link MAX_MULTIPLIER_VALUE}
 *   - dates must parse, and endsAt must be after startsAt when both are set
 *   - COURSE_PROMO needs courseId, LESSON_PROMO needs lessonId,
 *     STREAK_TIER needs streakDaysMin ≥ 1
 */
export function validateMultiplierDraft(d: MultiplierDraft): string[] {
  const errors: string[] = [];
  if (
    typeof d.value !== 'number' ||
    !Number.isFinite(d.value) ||
    d.value <= 0
  ) {
    errors.push('value must be a number greater than 0');
  } else if (d.value > MAX_MULTIPLIER_VALUE) {
    errors.push(`value must be at most ${MAX_MULTIPLIER_VALUE}`);
  }
  const s = ms(d.startsAt);
  const e = ms(d.endsAt);
  if (d.startsAt != null && s == null)
    errors.push('startsAt is not a valid date');
  if (d.endsAt != null && e == null) errors.push('endsAt is not a valid date');
  if (s != null && e != null && e <= s)
    errors.push('endsAt must be after startsAt');
  if (d.kind === 'COURSE_PROMO' && !d.courseId)
    errors.push('COURSE_PROMO requires courseId');
  if (d.kind === 'LESSON_PROMO' && !d.lessonId)
    errors.push('LESSON_PROMO requires lessonId');
  if (
    d.kind === 'STREAK_TIER' &&
    !(typeof d.streakDaysMin === 'number' && d.streakDaysMin >= 1)
  ) {
    errors.push('STREAK_TIER requires streakDaysMin ≥ 1');
  }
  return errors;
}
