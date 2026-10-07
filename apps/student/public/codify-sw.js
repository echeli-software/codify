/*
 * Codify student service worker (docs/16 §6, §9).
 *
 * Wraps Angular's ngsw-worker.js (app shell + lazy chunks precached per
 * ngsw-config.json) and adds one thing it can't do: images the app stored
 * explicitly in Cache Storage — downloaded lesson images ('codify-content-v1')
 * and the always-offline avatar / badge assets ('codify-assets-v1') — are
 * answered cache-first, so an <img src> keeps working offline.
 *
 * Authenticated API responses are never cached here: offline content comes
 * from IndexedDB (DownloadService), not from the service worker.
 *
 * This listener is registered before ngsw-worker.js so it runs first; it
 * only claims image requests that are already in one of our caches.
 */
const OFFLINE_CACHES = ['codify-assets-v1', 'codify-content-v1'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.destination !== 'image') return;
  if (req.headers.get('authorization')) return;
  // Same-origin app assets (icons, media) belong to ngsw's asset groups.
  const url = new URL(req.url);
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
    return;
  event.respondWith(
    (async () => {
      for (const name of OFFLINE_CACHES) {
        try {
          const cache = await caches.open(name);
          const hit = await cache.match(req.url, { ignoreVary: true });
          if (hit) return hit;
        } catch {
          /* fall through */
        }
      }
      return fetch(req);
    })(),
  );
  event.stopImmediatePropagation();
});

importScripts('./ngsw-worker.js');
