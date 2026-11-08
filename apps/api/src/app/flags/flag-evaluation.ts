import { createHash } from 'node:crypto';

/**
 * Pure feature-flag evaluation (docs/10 §9 A/B testing, docs/02
 * FeatureFlag). No I/O — FeatureFlagService loads the rows and calls these.
 *
 * Bucketing (stable, documented — clients and analytics may rely on it):
 *
 *   bucket(seed) = first 4 bytes of sha256(seed) as an unsigned big-endian
 *                  integer, mod 10 000  → 0..9999 (0.01 % resolution)
 *
 *   rollout/holdout bucket  b = bucket(`${key}:${userId}`)
 *   variant bucket          v = bucket(`${key}:${userId}:variant`)
 *
 * Evaluation, in order:
 *   1. Row inactive or `enabled: false`        → { enabled: false, variant: null }
 *   2. b < holdoutPct·100                      → { enabled: false, variant: 'holdout' }
 *   3. The rest (10 000 − H buckets) is the rollout population: enabled when
 *      (b − H) < rolloutPct/100 · (10 000 − H). Raising rolloutPct only ever
 *      adds users; the holdout never moves while holdoutPct is unchanged.
 *   4. Enabled with `variants` → weighted pick on v (cumulative weights,
 *      variant keys sorted by code point — independent of JSON key order,
 *      which Postgres jsonb does not preserve); without variants → null.
 *
 * Anonymous callers (no userId) cannot be bucketed: they never land in the
 * holdout, see the flag only at rolloutPct 100, and get the first variant.
 *
 * Experiments (flags with variants) are additionally subject to the
 * experiment policy — global hold-out + one experiment per surface — see
 * `evaluateWithPolicy` at the end of this file.
 */

export const BUCKETS = 10_000;
export const HOLDOUT_VARIANT = 'holdout';

/** `FeatureFlag.value` JSON. */
export interface FlagValue {
  enabled: boolean;
  /** 0–100; default 100. Share of non-holdout users who get the flag. */
  rolloutPct?: number;
  /** 0–100; default 0. Users carved out (enabled false, variant 'holdout'). */
  holdoutPct?: number;
  /** Variant key → relative weight (integers ≥ 0). */
  variants?: Record<string, number>;
  /** Where the flag is consumed; 'public' flags are served to anonymous callers. */
  surface?: string;
}

export interface FlagRow {
  key: string;
  value: FlagValue;
  isActive: boolean;
  /** Experiment priority (older first); missing = newest. */
  createdAt?: Date;
}

export interface FlagEvaluation {
  enabled: boolean;
  variant: string | null;
}

export function bucket(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

export function evaluateFlag(
  row: FlagRow | null | undefined,
  userId?: string | null,
): FlagEvaluation {
  const off: FlagEvaluation = { enabled: false, variant: null };
  if (!row || !row.isActive || row.value.enabled !== true) return off;
  const value = row.value;
  const holdout = pctToBuckets(value.holdoutPct ?? 0);
  const rollout = clampPct(value.rolloutPct ?? 100);

  if (!userId) {
    if (rollout < 100) return off;
    return { enabled: true, variant: firstVariant(value.variants) };
  }

  const b = bucket(`${row.key}:${userId}`);
  if (b < holdout) return { enabled: false, variant: HOLDOUT_VARIANT };
  const population = BUCKETS - holdout;
  if (b - holdout >= (rollout / 100) * population) return off;
  return {
    enabled: true,
    variant: pickVariant(
      value.variants,
      bucket(`${row.key}:${userId}:variant`),
    ),
  };
}

/** Weighted pick: v in 0..9999 scaled onto the cumulative weight range. */
export function pickVariant(
  variants: Record<string, number> | undefined,
  v: number,
): string | null {
  const entries = sortedVariants(variants);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const target = (v / BUCKETS) * total;
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w;
    if (target < acc) return key;
  }
  return entries[entries.length - 1][0];
}

function firstVariant(
  variants: Record<string, number> | undefined,
): string | null {
  const first = sortedVariants(variants)[0];
  return first ? first[0] : null;
}

function sortedVariants(
  variants: Record<string, number> | undefined,
): Array<[string, number]> {
  return Object.entries(variants ?? {})
    .filter(([, w]) => w > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}

function pctToBuckets(p: number): number {
  return Math.round((clampPct(p) / 100) * BUCKETS);
}

/**
 * Normalise an untrusted `value` JSON (DB row or admin input) into a
 * FlagValue, or return the list of problems.
 */
export function parseFlagValue(
  raw: unknown,
): { ok: true; value: FlagValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['value must be an object'] };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean')
    errors.push('enabled must be a boolean');
  const value: FlagValue = { enabled: r['enabled'] === true };
  for (const k of ['rolloutPct', 'holdoutPct'] as const) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100)
      errors.push(`${k} must be a number between 0 and 100`);
    else value[k] = v;
  }
  if (r['variants'] !== undefined && r['variants'] !== null) {
    const v = r['variants'];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      errors.push('variants must be an object of key → weight');
    } else {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > 20) errors.push('at most 20 variants');
      const out: Record<string, number> = {};
      for (const [key, w] of entries) {
        if (!/^[a-z0-9_-]{1,40}$/i.test(key))
          errors.push(`variant "${key}": key must be 1–40 of a-z 0-9 _ -`);
        else if (key === HOLDOUT_VARIANT)
          errors.push(`variant "${HOLDOUT_VARIANT}" is reserved`);
        else if (
          typeof w !== 'number' ||
          !Number.isInteger(w) ||
          w < 0 ||
          w > 10_000
        )
          errors.push(`variant "${key}": weight must be an integer 0–10000`);
        else out[key] = w;
      }
      if (entries.length > 0) value.variants = out;
    }
  }
  if (r['surface'] !== undefined && r['surface'] !== null) {
    const s = r['surface'];
    if (typeof s !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(s))
      errors.push('surface must be 1–40 of a-z 0-9 _ -');
    else value.surface = s;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// ─── Experiment policy (docs/10 §9) ─────────────────────────────────────

/**
 * The global hold-out: a built-in flag whose `holdoutPct` carves users out
 * of EVERY experiment for long-term retention measurement. Its own value
 * `{ enabled: true, holdoutPct: 5 }` = 5 % of signed-in users; turning it
 * off (or 0 %) disables the global hold-out.
 */
export const GLOBAL_HOLDOUT_KEY = 'experiments.global_holdout';
/** Surface of experiments that don't name one. */
export const DEFAULT_SURFACE = 'default';

/**
 * An engagement experiment = an active, enabled flag with at least one
 * variant of positive weight. Plain feature flags (no variants) are never
 * subject to the experiment policy.
 */
export function isExperiment(row: FlagRow | null | undefined): boolean {
  return (
    !!row &&
    row.key !== GLOBAL_HOLDOUT_KEY &&
    row.isActive &&
    row.value.enabled === true &&
    sortedVariants(row.value.variants).length > 0
  );
}

export function surfaceOf(row: FlagRow): string {
  return row.value.surface ?? DEFAULT_SURFACE;
}

/** True when the user falls in the global hold-out bucket. */
export function inGlobalHoldout(
  rows: ReadonlyMap<string, FlagRow>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  const row = rows.get(GLOBAL_HOLDOUT_KEY);
  return evaluateFlag(row, userId).variant === HOLDOUT_VARIANT;
}

/** Older experiments win; ties broken by key (stable, documented). */
function byPriority(a: FlagRow, b: FlagRow): number {
  const ta = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const tb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return ta - tb || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Evaluate one flag under the experiment policy:
 *   1. Not an experiment → plain `evaluateFlag`.
 *   2. User in the global hold-out → `{ enabled: false, variant: 'holdout' }`.
 *   3. At most one experiment per user per surface: the experiments of the
 *      flag's surface are walked in priority order (oldest `createdAt`
 *      first, then key); the first one that takes the user (rolled out, or
 *      in that experiment's own hold-out — its control group) owns the
 *      surface for them, and every later one answers
 *      `{ enabled: false, variant: null }`. Deterministic: same rows + user
 *      → same answer; a new experiment never reshuffles users of an older
 *      one, it only gets the users the older ones leave.
 */
export function evaluateWithPolicy(
  rows: ReadonlyMap<string, FlagRow>,
  row: FlagRow | null | undefined,
  userId: string | null | undefined,
): FlagEvaluation {
  if (!row || !isExperiment(row)) return evaluateFlag(row, userId);
  if (inGlobalHoldout(rows, userId))
    return { enabled: false, variant: HOLDOUT_VARIANT };
  const surface = surfaceOf(row);
  const competitors = [...rows.values()]
    .filter((r) => isExperiment(r) && surfaceOf(r) === surface)
    .sort(byPriority);
  for (const r of competitors) {
    const ev = evaluateFlag(r, userId);
    const takes = ev.enabled || ev.variant === HOLDOUT_VARIANT;
    if (r.key === row.key) return ev;
    if (takes) return { enabled: false, variant: null };
  }
  return evaluateFlag(row, userId);
}

/** Experiments per surface in priority order (admin overview). */
export function experimentSurfaces(
  rows: Iterable<FlagRow>,
): { surface: string; experiments: string[] }[] {
  const by = new Map<string, FlagRow[]>();
  for (const r of rows) {
    if (!isExperiment(r)) continue;
    const list = by.get(surfaceOf(r)) ?? [];
    list.push(r);
    by.set(surfaceOf(r), list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([surface, list]) => ({
      surface,
      experiments: list.sort(byPriority).map((r) => r.key),
    }));
}
