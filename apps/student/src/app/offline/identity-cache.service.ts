import { Injectable, inject, signal } from '@angular/core';
import {
  BillingClient,
  GamificationClient,
  ItemsClient,
  MeClient,
  type AvatarResponse,
  type BadgeView,
  type GamificationSummary,
  type InventoryItem,
  type MySubscriptionResponse,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import {
  AssetCacheService,
  PERSISTENT_ASSET_CACHE,
} from './asset-cache.service.js';
import { DownloadService } from './download.service.js';
import {
  IDENTITY_MAX_AGE_MS,
  IdentityStore,
  type CachedIdentity,
} from './identity-store.js';
import { NetworkStatusService } from './network-status.service.js';

/**
 * Keeps the offline identity bundle (docs/16 §4) in sync with the server.
 * `prime()` runs on sign-in / app boot:
 *   - Online: `/me` + gamification summary + avatar + inventory +
 *     subscription + badges (in parallel; a failing part keeps its previous
 *     cached value) → IndexedDB, then prefetches avatar/owned/equipped
 *     sprites and badge icons into the persistent asset cache.
 *   - Offline / server unreachable: the cached bundle for the same user.
 *
 * `identity()` is the bundle for the signed-in user (null otherwise) — the
 * shell header reads it so it renders offline.
 */
@Injectable({ providedIn: 'root' })
export class IdentityCacheService {
  private readonly meClient = inject(MeClient);
  private readonly gamification = inject(GamificationClient);
  private readonly items = inject(ItemsClient);
  private readonly billing = inject(BillingClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly assets = inject(AssetCacheService);
  private readonly downloads = inject(DownloadService);

  private readonly _identity = signal<CachedIdentity | null>(null);
  /** Cached bundle for the signed-in user. */
  readonly identity = this._identity.asReadonly();

  async prime(): Promise<CachedIdentity | null> {
    const authId = this.auth.user()?.id ?? null;
    const cached = await this.cachedFor(authId);
    if (cached) this._identity.set(cached);
    if (!this.network.online()) return cached;
    try {
      const me = await this.meClient.me();
      const [summary, avatar, inventory, subscription, badges] =
        await Promise.allSettled([
          this.gamification.summary(),
          this.items.avatar(),
          this.items.inventory(),
          this.billing.mySubscription(),
          this.gamification.badges(),
        ]);
      const bundle = buildBundle(
        authId ?? me.id,
        me,
        settled(summary),
        settled(avatar),
        settled(inventory),
        settled(subscription),
        settled(badges),
        cached,
        this.auth.user()?.avatarUrl ?? null,
      );
      await IdentityStore.set(bundle).catch(() => undefined);
      this._identity.set(bundle);
      void this.prefetchAssets(bundle, settled(avatar), settled(inventory));
      return bundle;
    } catch {
      // Server unreachable mid-fetch → keep the cache. A 401 is handled by
      // the auth interceptor (sign-in again); the cache stays for that user.
      return cached;
    }
  }

  /** The stored bundle, if it belongs to the signed-in user and isn't expired. */
  async cached(): Promise<CachedIdentity | null> {
    return this.cachedFor(this.auth.user()?.id ?? null);
  }

  /** Merge server-reconciled values (e.g. totals after a sync flush). */
  async patch(patch: Partial<Omit<CachedIdentity, 'userId'>>): Promise<void> {
    const current = this._identity() ?? (await this.cached());
    if (!current) return;
    const next = { ...current, ...patch };
    this._identity.set(next);
    await IdentityStore.set(next).catch(() => undefined);
  }

  async clear(): Promise<void> {
    this._identity.set(null);
    await IdentityStore.clear().catch(() => undefined);
    await this.assets.clear(PERSISTENT_ASSET_CACHE);
    await this.downloads.clearCachedAssets().catch(() => undefined);
  }

  /** True once the offline bundle is older than the session max (30 days). */
  isExpired(bundle: CachedIdentity | null): boolean {
    return !!bundle && Date.now() - bundle.fetchedAt > IDENTITY_MAX_AGE_MS;
  }

  private async cachedFor(
    authId: string | null,
  ): Promise<CachedIdentity | null> {
    try {
      const b = await IdentityStore.get();
      if (!b || !authId || b.userId !== authId) return null;
      return b;
    } catch {
      return null;
    }
  }

  /** Avatar base, equipped + owned sprites, badge icons → persistent cache. */
  private async prefetchAssets(
    bundle: CachedIdentity,
    avatar: AvatarResponse | null,
    inventory: InventoryItem[] | null,
  ): Promise<void> {
    try {
      if (avatar || inventory) {
        await this.downloads.prefetchAssets({ avatar, inventory });
      }
      const refs = [
        ...Object.values(avatar?.equipped ?? {}).map((e) => e?.spriteAssetId),
        ...(bundle.ownedItems ?? []).map((i) => i.spriteAssetId),
        ...(inventory ?? []).map((i) => i.item.thumbnailAssetId),
        ...(bundle.badges ?? []).map((b) => b.iconName),
        bundle.avatarUrl,
        typeof avatar?.config?.['baseUrl'] === 'string'
          ? (avatar.config['baseUrl'] as string)
          : null,
      ];
      const urls = refs
        .map((r) => this.assets.assetUrl(r ?? null))
        .filter((u): u is string => !!u);
      if (urls.length > 0)
        await this.assets.cacheUrls(urls, PERSISTENT_ASSET_CACHE);
    } catch {
      /* best-effort */
    }
  }
}

function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === 'fulfilled' ? r.value : null;
}

function buildBundle(
  userId: string,
  me: Awaited<ReturnType<MeClient['me']>>,
  summary: GamificationSummary | null,
  avatar: AvatarResponse | null,
  inventory: InventoryItem[] | null,
  subscription: MySubscriptionResponse | null,
  badges: BadgeView[] | null,
  prev: CachedIdentity | null,
  avatarUrl: string | null,
): CachedIdentity {
  const active =
    subscription?.subscriptions.find((s) => s.grantsAccess) ?? null;
  return {
    userId,
    serverUserId: me.id,
    email: me.email,
    displayName: me.displayName,
    locale: me.locale,
    role: me.role,
    totalXp: summary?.totalXp ?? me.totalXp,
    coins: summary?.coins ?? me.coins,
    level: summary?.level ?? prev?.level,
    streakDays: summary?.streak.currentDays ?? prev?.streakDays,
    longestStreakDays: summary?.streak.longestDays ?? prev?.longestStreakDays,
    freezesAvailable:
      summary?.streak.freezesAvailable ?? prev?.freezesAvailable,
    avatarUrl: avatarUrl ?? prev?.avatarUrl ?? null,
    avatar: avatar
      ? {
          config: avatar.config,
          equipped: avatar.equipped as Record<string, unknown>,
        }
      : (prev?.avatar ?? null),
    ownedItems: inventory
      ? inventory.map((i) => ({
          id: i.item.id,
          slug: i.item.slug,
          name: i.item.name,
          slot: i.item.slot,
          rarity: i.item.rarity,
          spriteAssetId: i.item.spriteAssetId,
          equipped: i.equipped,
        }))
      : (prev?.ownedItems ?? []),
    subscription: subscription
      ? active
        ? {
            planId: active.planId,
            planName: active.planName,
            status: active.status,
            source: active.source,
            currentPeriodEnd: active.currentPeriodEnd,
            grantsAccess: active.grantsAccess,
          }
        : null
      : (prev?.subscription ?? null),
    activePlanIds: subscription?.activePlanIds ?? prev?.activePlanIds ?? [],
    badges: badges
      ? badges
          .filter((b) => b.earned)
          .map((b) => ({ slug: b.slug, name: b.name, iconName: b.iconName }))
      : (prev?.badges ?? []),
    fetchedAt: Date.now(),
  };
}
