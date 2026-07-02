// Bump on any caching-policy change so `activate` evicts prior caches. v6 adds
// an offline app shell: a precached /offline.html fallback for navigations, a
// last-known-good copy of index.html, and cache-first serving of Vite's
// content-hashed /assets/ bundles. v5 and earlier caches (which could contain
// PHI attachments before the allowlist tightened) are purged on activate.
const CACHE_NAME = 'base44-offline-v6';
const OFFLINE_URL = '/offline.html';
// Fixed cache key for the most recent successfully fetched index.html. Cached
// under one key (not per-route URL) because every SPA navigation serves the
// same shell document.
const SHELL_KEY = '/index.html';

self.addEventListener('install', (event) => {
  // Activate the new worker immediately. The only precached document is the
  // static offline fallback page — never the app shell itself, so an updated
  // index.html (with new hashed JS) is always fetched fresh while online.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
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

  const isSameOrigin = url.startsWith(self.location.origin + '/');
  const pathname = isSameOrigin ? new URL(url).pathname : '';

  // Navigations are network-FIRST so a deployed fix is picked up immediately.
  // Only when the network is unreachable (installed app launched offline, or
  // connectivity dropped) fall back to the last successfully fetched shell —
  // the SPA then renders and its own offline queue/cached data take over. If
  // no shell was ever cached (first launch offline), serve the static branded
  // offline page instead of the browser's network-error screen.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_KEY, cloned));
          }
          return response;
        })
        .catch(async () => {
          const shell = await caches.match(SHELL_KEY);
          if (shell) return shell;
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Vite content-hashes everything under /assets/ (index-Cx3f….js), so a given
  // URL's bytes can never change — cache-first is both safe (a new deploy ships
  // new URLs via the network-first shell above) and what makes lazy route
  // chunks loadable while offline. No PHI: these are the app's own JS/CSS.
  if (isSameOrigin && pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        });
      })
    );
    return;
  }

  // Any OTHER app code (js/css/html outside /assets/, e.g. /sw.js itself) must
  // always come from the network so a deployed fix can't be masked by a stale
  // cached copy.
  const isAppCode = /\.(?:js|mjs|css|html)(?:\?|$)/.test(url);
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
