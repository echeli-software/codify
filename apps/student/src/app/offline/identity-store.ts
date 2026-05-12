import { idbStores, tx } from './db.js';

/**
 * Cached identity bundle persisted on sign-in.  Lets the app render an
 * authenticated shell offline (per /docs/16-offline §4).  Server is the
 * source of truth; this cache is a 30-day read-through (Clerk's session
 * max — currently we just store whatever /me last returned without TTL
 * enforcement; will tighten when Clerk lands).
 */
export interface CachedIdentity {
  userId: string;
  email: string;
  displayName: string;
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SUPPORT';
  totalXp: number;
  coins: number;
  /** Wall-clock ms; client decides when to consider stale. */
  fetchedAt: number;
}

const KEY = 'current';

export const IdentityStore = {
  get(): Promise<CachedIdentity | null> {
    return tx<CachedIdentity | null>(idbStores.STORE_IDENTITY, 'readonly', (s) => {
      const req = s.get(KEY);
      return req as unknown as IDBRequest<CachedIdentity | null>;
    });
  },
  async set(identity: CachedIdentity): Promise<void> {
    await tx<IDBValidKey>(idbStores.STORE_IDENTITY, 'readwrite', (s) =>
      s.put(identity, KEY),
    );
  },
  async clear(): Promise<void> {
    await tx<undefined>(idbStores.STORE_IDENTITY, 'readwrite', (s) => s.clear());
  },
};
