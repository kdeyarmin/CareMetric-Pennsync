// Bump on any caching-policy change so `activate` evicts prior caches. v5 tightens
// the fetch allowlist (below) and purges v4, which could contain PHI attachments.
const CACHE_NAME = 'base44-offline-v5';

self.addEventListener('install', () => {
  // Activate the new worker immediately; do not precache the app shell so an
  // updated index.html (with new hashed JS) is always fetched fresh.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  if (url.includes('/api/')) return;

  // NEVER cache the app code or HTML — these must always come from the network
  // so a deployed fix can't be masked by a stale cached bundle. Only opaque
  // static assets (images/fonts) use the offline cache.
  const isAppCode =
    event.request.mode === 'navigate' ||
    /\.(?:js|mjs|css|html)(?:\?|$)/.test(url);

  if (isAppCode) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Only cache truly static, non-PHI assets. Patient documents (PDFs, wound
  // photos, fax/referral images) are served from backend/storage origins; writing
  // them to CacheStorage — which is unencrypted, has no TTL, and is not cleared on
  // logout — leaves PHI at rest on a shared/lost device. Allow only: fonts (never
  // PHI, may be a CDN cross-origin) and SAME-ORIGIN app images/icons. Everything
  // else (all cross-origin responses, and any PDF) goes straight to the network
  // with no caching.
  const isFont = /\.(?:woff2?|ttf|otf|eot)(?:\?|$)/i.test(url);
  const isSameOrigin = url.startsWith(self.location.origin + '/');
  const isSameOriginImage =
    isSameOrigin && /\.(?:png|jpe?g|gif|svg|webp|ico)(?:\?|$)/i.test(url);

  if (!isFont && !isSameOriginImage) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache a real, successful, non-opaque response (opaque cross-origin
        // responses can't be inspected, so never persist them).
        if (response && response.ok && response.type !== 'opaque') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
