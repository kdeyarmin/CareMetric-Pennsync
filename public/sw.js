const CACHE_NAME = 'base44-offline-v4';

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

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
