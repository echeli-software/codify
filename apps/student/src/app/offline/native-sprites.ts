import { inject, type Provider } from '@angular/core';
import { SPRITE_URL_RESOLVER, type SpriteUrlResolver } from '@codify/ui-ionic';
import { isNativeRuntime } from '../platform/runtime.js';
import { NativeSpriteStore } from './native-image-store.service.js';

/**
 * `SPRITE_URL_RESOLVER` for `cdf-item-sprite` / `cdf-avatar-renderer`: in
 * the native shell an equipped / owned sprite renders from its device-local
 * copy (`NativeSpriteStore`), so the avatar still shows offline. On the web
 * it resolves nothing — the service worker answers those images from Cache
 * Storage instead.
 *
 * Provided by the lazily loaded IonicRoot (every page renders under it), so
 * `@codify/ui-ionic` stays out of the initial bundle.
 */
export function provideNativeSprites(): Provider {
  return {
    provide: SPRITE_URL_RESOLVER,
    useFactory: (): SpriteUrlResolver => {
      if (!isNativeRuntime()) return { resolve: () => null };
      const store = inject(NativeSpriteStore);
      void store.init();
      return { resolve: (url) => store.resolve(url) };
    },
  };
}
