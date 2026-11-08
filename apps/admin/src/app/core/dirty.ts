/**
 * Dirty tracking for the admin's plain-object forms (docs/04 §5
 * "unsaved-changes guard"): take a snapshot when a form is loaded or
 * reset, compare on navigation. Snapshots are key-order independent.
 */

/** Stable JSON: object keys sorted, `undefined` dropped. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return val;
  });
}

export class DirtyTracker<T> {
  private base: string | null = null;

  constructor(private readonly read: () => T) {}

  /** Remember the current value as the clean state. */
  mark(): void {
    this.base = stableStringify(this.read());
  }

  /** Stop tracking (form closed or saved and dismissed). */
  clear(): void {
    this.base = null;
  }

  get tracking(): boolean {
    return this.base !== null;
  }

  isDirty(): boolean {
    return this.base !== null && stableStringify(this.read()) !== this.base;
  }
}
