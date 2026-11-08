/**
 * Generic numeric editing of gamification config values (docs/04 Settings
 * "default coin rates"): a value is flattened into its numeric leaves
 * (`READING.coins` → 5) for plain number inputs and rebuilt on save, so new
 * keys added to `GAMIFICATION_CONFIG_DEFAULTS` need no UI change.
 */

export interface ConfigLeaf {
  /** Dot path inside the value ('' for a bare number). */
  path: string;
  value: number;
}

/** Numeric leaves of `v`, or null when it holds anything but numbers/objects. */
export function numericLeaves(v: unknown, prefix = ''): ConfigLeaf[] | null {
  if (typeof v === 'number') return [{ path: prefix, value: v }];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: ConfigLeaf[] = [];
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    const leaves = numericLeaves(child, prefix ? `${prefix}.${k}` : k);
    if (!leaves) return null;
    out.push(...leaves);
  }
  return out;
}

/** Rebuild a value from `template`'s shape with `leaves` applied. */
export function withLeaves(
  template: unknown,
  leaves: readonly ConfigLeaf[],
): unknown {
  const by = new Map(leaves.map((l) => [l.path, l.value]));
  const walk = (v: unknown, prefix: string): unknown => {
    if (typeof v === 'number') return by.has(prefix) ? by.get(prefix) : v;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, child]) => [
        k,
        walk(child, prefix ? `${prefix}.${k}` : k),
      ]),
    );
  };
  return walk(template, '');
}

/** Config keys shown as "default coin rates" (earning + coin limits). */
export function isCoinRateKey(key: string): boolean {
  return (
    /^(earning|coins)\./.test(key) || key === 'billing.firstPaymentBonusCoins'
  );
}
