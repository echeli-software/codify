/**
 * Latest-wins guard for filter-driven loads (catalog, shop, …). The typed
 * API clients return Promises, so an in-flight HTTP call can't be aborted;
 * instead every load takes a ticket and a response is applied only while
 * its ticket is still the newest. A slow response for an old filter can
 * therefore never overwrite the result of a newer one.
 *
 *   private readonly guard = new StaleGuard();
 *   const res = await this.guard.run(() => client.list(q));
 *   if (res.stale) return;            // a newer request superseded us
 */
export type GuardResult<T> =
  | { stale: true }
  | { stale: false; ok: true; value: T }
  | { stale: false; ok: false; error: unknown };

export class StaleGuard {
  private seq = 0;

  /** Ticket of the newest request (exposed for tests). */
  get current(): number {
    return this.seq;
  }

  /** Invalidate every in-flight request (e.g. on destroy). */
  cancel(): void {
    this.seq++;
  }

  async run<T>(fn: () => Promise<T>): Promise<GuardResult<T>> {
    const ticket = ++this.seq;
    try {
      const value = await fn();
      if (ticket !== this.seq) return { stale: true };
      return { stale: false, ok: true, value };
    } catch (error) {
      if (ticket !== this.seq) return { stale: true };
      return { stale: false, ok: false, error };
    }
  }
}
