import { Injectable } from '@angular/core';

/**
 * Persistent asset cache (avatar base, equipped + owned item sprites, badge
 * icons). Never evicted by the download budget (docs/16 §6: "a signed-in
 * user's avatar must always render offline").
 */
export const PERSISTENT_ASSET_CACHE = 'codify-assets-v1';
/** Lesson images that belong to course downloads (removed with the course). */
export const CONTENT_ASSET_CACHE = 'codify-content-v1';

export interface CacheUrlsResult {
  /** URLs now present in the cache. */
  cached: string[];
  /** Bytes stored (opaque cross-origin responses count as 0). */
  bytes: number;
  failed: string[];
}

/**
 * Thin wrapper over the Cache Storage API. The app's service worker
 * (`public/codify-sw.js`) answers image requests from these caches first,
 * so an `<img src>` keeps working offline without rewriting markup.
 * No-ops where Cache Storage is unavailable (jsdom, very old WebViews).
 */
@Injectable({ providedIn: 'root' })
export class AssetCacheService {
  get supported(): boolean {
    return typeof caches !== 'undefined' && typeof fetch !== 'undefined';
  }

  /**
   * Item `spriteAssetId` / badge icon → fetchable URL, or null when the id
   * is an inline glyph (`emoji:` / `color:`), a bundled icon name, or a
   * bare asset id the client can't resolve to a URL.
   */
  assetUrl(ref: string | null | undefined): string | null {
    if (!ref) return null;
    if (/^https?:\/\//i.test(ref)) return ref;
    if (ref.startsWith('/') && !ref.startsWith('//')) return ref;
    return null;
  }

  /** Fetch + store each URL (skipping ones already cached). Never throws. */
  async cacheUrls(
    urls: readonly string[],
    cacheName: string,
  ): Promise<CacheUrlsResult> {
    const out: CacheUrlsResult = { cached: [], bytes: 0, failed: [] };
    if (!this.supported) return out;
    const unique = [...new Set(urls.filter(Boolean))];
    let cache: Cache;
    try {
      cache = await caches.open(cacheName);
    } catch {
      return { ...out, failed: unique };
    }
    for (const url of unique) {
      try {
        const hit = await cache.match(url);
        if (hit) {
          out.cached.push(url);
          out.bytes += await sizeOf(hit);
          continue;
        }
        let res: Response;
        try {
          res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        } catch {
          // CDN without CORS: store the opaque response — still renders in <img>.
          res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
        }
        if (!res.ok && res.type !== 'opaque') {
          out.failed.push(url);
          continue;
        }
        out.bytes += await sizeOf(res.clone());
        await cache.put(url, res);
        out.cached.push(url);
      } catch {
        out.failed.push(url);
      }
    }
    return out;
  }

  /** Remove URLs from a cache. Never throws. */
  async removeUrls(urls: readonly string[], cacheName: string): Promise<void> {
    if (!this.supported || urls.length === 0) return;
    try {
      const cache = await caches.open(cacheName);
      for (const url of urls) await cache.delete(url);
    } catch {
      /* ignore */
    }
  }

  /** Drop a whole cache (sign-out clears the persistent avatar cache). */
  async clear(cacheName: string): Promise<void> {
    if (!this.supported) return;
    try {
      await caches.delete(cacheName);
    } catch {
      /* ignore */
    }
  }
}

async function sizeOf(res: Response): Promise<number> {
  if (res.type === 'opaque') return 0;
  const header = Number(res.headers.get('content-length'));
  if (Number.isFinite(header) && header > 0) return header;
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
}
