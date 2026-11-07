import { InjectionToken } from '@angular/core';

/**
 * Maps an uploaded sprite's `spriteUrl` to the URL actually rendered —
 * e.g. the native shell's device-local copy, so equipped / owned sprites
 * still show offline (docs/16 §8). Return null to keep the original URL.
 * May read signals: `cdf-item-sprite` / `cdf-avatar-renderer` re-render
 * when they change.
 */
export interface SpriteUrlResolver {
  resolve(url: string): string | null;
}

/** Optional; without it sprites render from their `spriteUrl` as-is. */
export const SPRITE_URL_RESOLVER = new InjectionToken<SpriteUrlResolver>(
  'SPRITE_URL_RESOLVER',
);
