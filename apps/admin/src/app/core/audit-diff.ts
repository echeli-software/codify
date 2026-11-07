/** One row of the audit diff viewer. */
export interface DiffRow {
  field: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Compact display of a JSON value (strings unquoted). */
export function showValue(v: unknown): string | null {
  if (v === undefined) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * Normalise an audit `diff` (free-form JSON) into viewer rows:
 *   - `{ before: {...}, after: {...} }` → one row per field in either side
 *   - any other object → one "after" row per key (the recorded change set)
 *   - scalars/arrays → a single `value` row
 * Returns [] for an empty diff.
 */
export function diffRows(diff: unknown): DiffRow[] {
  if (diff === null || diff === undefined) return [];
  if (!isRecord(diff))
    return [
      { field: 'value', before: null, after: showValue(diff), changed: true },
    ];
  const { before, after, ...rest } = diff;
  if (isRecord(before) || isRecord(after)) {
    const b = isRecord(before) ? before : {};
    const a = isRecord(after) ? after : {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    const rows = keys.map((field) => {
      const bv = showValue(b[field]);
      const av = showValue(a[field]);
      return { field, before: bv, after: av, changed: bv !== av };
    });
    // Context recorded alongside before/after (e.g. reason).
    for (const [field, v] of Object.entries(rest))
      rows.push({ field, before: null, after: showValue(v), changed: false });
    return rows;
  }
  return Object.entries(diff).map(([field, v]) => ({
    field,
    before: null,
    after: showValue(v),
    changed: true,
  }));
}

/** ISO bound for a `datetime-local` / `date` filter value. */
export function filterBoundToIso(
  local: string,
  edge: 'start' | 'end',
): string | undefined {
  if (!local) return undefined;
  const withTime = /T\d{2}:\d{2}/.test(local)
    ? local
    : `${local}T${edge === 'start' ? '00:00' : '23:59:59.999'}`;
  const d = new Date(withTime);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
