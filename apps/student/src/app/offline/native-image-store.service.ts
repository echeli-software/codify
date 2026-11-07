import { Injectable, signal } from '@angular/core';
import type { Directory, FilesystemPlugin } from '@capacitor/filesystem';
import type { PreferencesPlugin } from '@capacitor/preferences';
import { isNativeRuntime } from '../platform/runtime.js';
import type { CacheUrlsResult } from './asset-cache.service.js';

/** Folder under `Directory.Data` holding downloaded lesson images. */
export const NATIVE_IMAGE_DIR = 'lesson-images';
const INDEX_KEY = 'codify.nativeImages.v1';
/** `Directory.Data` by value — avoids importing the plugin eagerly. */
const DATA_DIR = 'DATA' as unknown as Directory;

interface CapacitorFileSrc {
  convertFileSrc?: (filePath: string) => string;
}

/**
 * Stable file name for an image URL: two independent 32-bit hashes (FNV-1a
 * + djb2) plus the URL's extension. Pure — unit-tested.
 */
export function nativeImageFileName(url: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < url.length; i += 1) {
    const c = url.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + c) >>> 0;
  }
  const ext = /\.(png|jpe?g|gif|webp|svg|avif)(?:[?#]|$)/i
    .exec(url)?.[1]
    ?.toLowerCase();
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return `${hex(fnv)}${hex(djb)}${ext ? `.${ext}` : ''}`;
}

/**
 * Lesson images of course downloads on the device filesystem (docs/16 §8,
 * "Capacitor Filesystem (mobile) / Cache Storage API (web)").
 *
 * In the native shell the service worker isn't running, so Cache Storage
 * can't answer `<img>` requests offline. Instead each image is downloaded
 * natively (`Filesystem.downloadFile`, no CORS) into
 * `Directory.Data/lesson-images/`, an index (URL → bytes) is kept in
 * Capacitor Preferences, and the lesson renderer maps a stored URL to its
 * WebView-readable local URL through `resolve()` (see
 * `platform/lazy-providers.ts` → `LESSON_IMAGE_RESOLVER`).
 *
 * The API mirrors `AssetCacheService` (`store` ≈ `cacheUrls`), so the
 * DownloadService size accounting, removal and eviction treat both stores
 * the same way. Every method is a safe no-op on the web.
 */
@Injectable({ providedIn: 'root' })
export class NativeImageStore {
  /** Folder under `Directory.Data` (subclasses keep their own). */
  protected readonly dir: string = NATIVE_IMAGE_DIR;
  /** Preferences key of the URL → bytes index. */
  protected readonly indexKey: string = INDEX_KEY;
  /** URL → bytes of every stored image (reactive: the renderer re-resolves). */
  private readonly index = signal<ReadonlyMap<string, number>>(new Map());
  private baseUri: string | null = null;
  private initP: Promise<void> | null = null;
  private fsP: Promise<FilesystemPlugin | null> | null = null;
  private prefsP: Promise<PreferencesPlugin | null> | null = null;

  /** True inside the Capacitor shell (where this store replaces Cache Storage). */
  get supported(): boolean {
    return isNativeRuntime();
  }

  /** Load the index + the data directory URI (once). */
  init(): Promise<void> {
    if (!this.supported) return Promise.resolve();
    if (!this.initP) {
      this.initP = (async () => {
        try {
          const prefs = await this.prefs();
          const raw = (await prefs?.get({ key: this.indexKey }))?.value;
          const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
          this.index.set(new Map(Object.entries(parsed)));
        } catch {
          /* unreadable index → treat as empty */
        }
        try {
          const fs = await this.fs();
          const res = await fs?.getUri({
            directory: DATA_DIR,
            path: this.dir,
          });
          this.baseUri = res?.uri ?? null;
        } catch {
          this.baseUri = null;
        }
      })();
    }
    return this.initP;
  }

  /** Stored URLs (for tests / diagnostics). */
  storedUrls(): string[] {
    return [...this.index().keys()];
  }

  /**
   * WebView URL of the local copy of `url`, or null when it isn't stored
   * (or the store hasn't loaded yet). Synchronous and signal-backed, so a
   * template calling it re-renders once the index is ready.
   */
  resolve(url: string): string | null {
    if (!this.index().has(url) || !this.baseUri) return null;
    const convert = (globalThis as { Capacitor?: CapacitorFileSrc }).Capacitor
      ?.convertFileSrc;
    const fileUri = `${this.baseUri.replace(/\/+$/, '')}/${nativeImageFileName(url)}`;
    return convert ? convert(fileUri) : fileUri;
  }

  /** Download + store each URL (skipping stored ones). Never throws. */
  async store(urls: readonly string[]): Promise<CacheUrlsResult> {
    const out: CacheUrlsResult = { cached: [], bytes: 0, failed: [] };
    const unique = [...new Set(urls.filter(Boolean))];
    if (!this.supported || unique.length === 0)
      return { ...out, failed: this.supported ? [] : unique };
    await this.init();
    const fs = await this.fs();
    if (!fs) return { ...out, failed: unique };
    const added = new Map<string, number>();
    for (const url of unique) {
      const known = this.index().get(url);
      if (known !== undefined) {
        out.cached.push(url);
        out.bytes += known;
        continue;
      }
      const path = `${this.dir}/${nativeImageFileName(url)}`;
      try {
        await fs.downloadFile({
          url,
          path,
          directory: DATA_DIR,
          recursive: true,
        });
        const stat = await fs
          .stat({ path, directory: DATA_DIR })
          .catch(() => null);
        const bytes = Number(stat?.size) || 0;
        added.set(url, bytes);
        out.cached.push(url);
        out.bytes += bytes;
      } catch {
        out.failed.push(url);
      }
    }
    if (added.size > 0) {
      this.index.update((m) => new Map([...m, ...added]));
      await this.persist();
    }
    return out;
  }

  /** Delete stored images. Never throws. */
  async remove(urls: readonly string[]): Promise<void> {
    if (!this.supported || urls.length === 0) return;
    await this.init();
    const fs = await this.fs();
    const gone = new Set<string>();
    for (const url of urls) {
      if (!this.index().has(url)) continue;
      gone.add(url);
      await fs
        ?.deleteFile({
          path: `${this.dir}/${nativeImageFileName(url)}`,
          directory: DATA_DIR,
        })
        .catch(() => undefined);
    }
    if (gone.size === 0) return;
    this.index.update((m) => new Map([...m].filter(([url]) => !gone.has(url))));
    await this.persist();
  }

  /** Delete every stored image not in `keep` (prune stale entries). */
  async retainOnly(keep: readonly string[]): Promise<void> {
    if (!this.supported) return;
    await this.init();
    const wanted = new Set(keep);
    await this.remove(this.storedUrls().filter((u) => !wanted.has(u)));
  }

  /** Remove every stored lesson image (Downloads → "Remove all", sign-out). */
  async clear(): Promise<void> {
    if (!this.supported) return;
    await this.init();
    const fs = await this.fs();
    await fs
      ?.rmdir({
        path: this.dir,
        directory: DATA_DIR,
        recursive: true,
      })
      .catch(() => undefined);
    this.index.set(new Map());
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const prefs = await this.prefs();
      await prefs?.set({
        key: this.indexKey,
        value: JSON.stringify(Object.fromEntries(this.index())),
      });
    } catch {
      /* index is rebuilt by re-downloading on the next update */
    }
  }

  private fs(): Promise<FilesystemPlugin | null> {
    if (!this.fsP) {
      this.fsP = this.supported
        ? import('@capacitor/filesystem')
            .then((m) => m.Filesystem)
            .catch(() => null)
        : Promise.resolve(null);
    }
    return this.fsP;
  }

  private prefs(): Promise<PreferencesPlugin | null> {
    if (!this.prefsP) {
      this.prefsP = this.supported
        ? import('@capacitor/preferences')
            .then((m) => m.Preferences)
            .catch(() => null)
        : Promise.resolve(null);
    }
    return this.prefsP;
  }
}

/** Folder under `Directory.Data` holding equipped / owned item sprites. */
export const NATIVE_SPRITE_DIR = 'item-sprites';

/**
 * Uploaded item sprites (`spriteUrl`) of the signed-in user's equipped and
 * owned items, on the device filesystem — the native counterpart of the
 * persistent Cache Storage copy the PWA keeps (`codify-assets-v1`).
 * Filled by IdentityCacheService, rendered through `SPRITE_URL_RESOLVER`
 * (see ./native-sprites.ts). Separate from the lesson images so "Remove
 * all downloads" leaves the avatar intact.
 */
@Injectable({ providedIn: 'root' })
export class NativeSpriteStore extends NativeImageStore {
  protected override readonly dir = NATIVE_SPRITE_DIR;
  protected override readonly indexKey = 'codify.nativeSprites.v1';
}
