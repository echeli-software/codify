import { idbAvailable, idbStores, tx } from './db.js';

/** Owned item, trimmed to what the offline dressing room + header need. */
export interface CachedOwnedItem {
  id: string;
  slug: string;
  name: string;
  slot: string;
  rarity: string;
  spriteAssetId: string;
  equipped: boolean;
}

export interface CachedSubscription {
  planId: string;
  planName: string;
  status: string;
  source: string;
  currentPeriodEnd: string;
  grantsAccess: boolean;
}

export interface CachedBadge {
  slug: string;
  name: string;
  iconName: string | null;
}

/**
 * Identity bundle cached on sign-in so the app renders an authenticated
 * shell offline (docs/16 §4): user, locale, level, XP, coins, streak, owned
 * items, avatar config + equipped items, active subscription, badges.
 * Server is the source of truth; this is a read-through cache.
 */
export interface CachedIdentity {
  /** AuthService user id (what the offline queue is keyed by). */
  userId: string;
  /** Server `User.id` (RevenueCat app user id, analytics). */
  serverUserId?: string;
  email: string;
  displayName: string;
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SUPPORT';
  totalXp: number;
  coins: number;
  level?: number;
  streakDays?: number;
  longestStreakDays?: number;
  freezesAvailable?: number;
  avatarUrl?: string | null;
  /** `AvatarResponse` (config + equipped refs). */
  avatar?: {
    config: Record<string, unknown> | null;
    equipped: Record<string, unknown>;
  } | null;
  ownedItems?: CachedOwnedItem[];
  subscription?: CachedSubscription | null;
  activePlanIds?: string[];
  badges?: CachedBadge[];
  /** Wall-clock ms of the last successful refresh. */
  fetchedAt: number;
}

/** Offline identity stays usable this long after the last refresh (Clerk session max). */
export const IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const KEY = 'current';

export const IdentityStore = {
  async get(): Promise<CachedIdentity | null> {
    if (!idbAvailable()) return null;
    const v = await tx<CachedIdentity | undefined>(
      idbStores.STORE_IDENTITY,
      'readonly',
      (s) => s.get(KEY) as IDBRequest<CachedIdentity | undefined>,
    );
    return v ?? null;
  },
  async set(identity: CachedIdentity): Promise<void> {
    if (!idbAvailable()) return;
    await tx<IDBValidKey>(idbStores.STORE_IDENTITY, 'readwrite', (s) =>
      s.put(identity, KEY),
    );
  },
  async clear(): Promise<void> {
    if (!idbAvailable()) return;
    await tx<undefined>(idbStores.STORE_IDENTITY, 'readwrite', (s) =>
      s.clear(),
    );
  },
};
