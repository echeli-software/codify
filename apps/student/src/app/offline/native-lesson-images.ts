import { inject, type Provider } from '@angular/core';
import {
  LESSON_IMAGE_RESOLVER,
  type LessonImageResolver,
} from '@codify/ui-bootstrap';
import { isNativeRuntime } from '../platform/runtime.js';
import { NativeImageStore } from './native-image-store.service.js';

/**
 * `LESSON_IMAGE_RESOLVER` for the lesson renderer: in the native shell a
 * downloaded lesson image renders from its device-local copy
 * (`NativeImageStore`, docs/16 §8). On the web it resolves nothing — the
 * service worker answers downloaded images from Cache Storage instead.
 *
 * Provide it on the component that hosts `<cdf-lesson-block-renderer>`
 * (lazy) — importing `@codify/ui-bootstrap` from eager code would pull the
 * renderer into the initial bundle.
 */
export function provideNativeLessonImages(): Provider {
  return {
    provide: LESSON_IMAGE_RESOLVER,
    useFactory: (): LessonImageResolver => {
      if (!isNativeRuntime()) return { resolve: () => null };
      const store = inject(NativeImageStore);
      void store.init();
      return { resolve: (src) => store.resolve(src) };
    },
  };
}
