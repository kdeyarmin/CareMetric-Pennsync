import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
// Self-host the Inter variable font (weight axis 100–900) instead of fetching it
// from the Google Fonts CDN. Vite bundles the woff2, so the app keeps its
// typography with no third-party request — better for HIPAA posture and for
// slow connections. The @font-face family it declares is 'Inter Variable' (see
// tailwind.config.js fontFamily.sans).
import '@fontsource-variable/inter'
import '@/index.css'
import '@/styles/button-contrast.css'
import { installAlertToToastShim } from '@/lib/alert-shim'

// Surface legacy window.alert() notifications as on-brand toasts.
installAlertToToastShim()

// Apply the native/web color scheme before React paints. Users can override by
// setting localStorage.theme to "light" or "dark"; otherwise the OS preference
// drives Tailwind's class-based dark mode.
const safeStorage = (storage) => ({
  getItem(key) {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      storage?.setItem(key, value);
    } catch {
      // Storage can be unavailable in privacy-restricted/embed contexts.
    }
  },
  removeItem(key) {
    try {
      storage?.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted/embed contexts.
    }
  },
});

let localStorageRef = null;
let sessionStorageRef = null;
// Merely TOUCHING window.localStorage throws in some privacy modes and in
// sandboxed iframes. Leaving the ref null is the intended outcome — safeStorage
// below falls back to an in-memory shim — so both catches are deliberate no-ops.
try { localStorageRef = window.localStorage; } catch { /* storage unavailable */ }
try { sessionStorageRef = window.sessionStorage; } catch { /* storage unavailable */ }

const safeLocalStorage = safeStorage(localStorageRef);
const safeSessionStorage = safeStorage(sessionStorageRef);

const savedTheme = safeLocalStorage.getItem('theme')
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
  document.documentElement.classList.add('dark')
  document.documentElement.style.colorScheme = 'dark'
} else {
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = 'light'
}

// ── Stale-chunk auto-recovery ───────────────────────────────────────────────
// When the Vite dev server restarts, the browser's in-memory module graph holds
// chunk URLs (dep pre-bundle hashes, ?t= timestamps) the restarted server no
// longer serves. Any dynamic import() that touches those stale URLs rejects as
// "TypeError: Failed to fetch dynamically imported module". This handler catches
// that error globally — before React's render cycle reaches the per-route
// ErrorBoundary — and silently reloads the page once to re-fetch a fresh
// module graph. sessionStorage guards against a reload loop. This is the
// earliest possible recovery point (fires during module evaluation, not render).
// Distinct from the ErrorBoundary's key (vite-chunk-reloaded) so the two
// mechanisms — this global handler (module-evaluation phase) and the
// per-route ErrorBoundary (React render phase) — never clear each other's
// flag. They catch different error propagation paths and are complementary.
const VITE_CHUNK_KEY = 'vite-global-chunk-reloaded';
const handleStaleChunk = (err, fallbackMessage = '') => {
  const msg = err?.message || fallbackMessage || '';
  const name = err?.name || '';
  const isStaleChunk = (name === 'TypeError' &&
    /dynamically imported module/i.test(msg)) ||
    (name === 'SyntaxError' &&
    /invalid or unexpected token|unexpected token/i.test(msg));
  if (!isStaleChunk) return false;
  // A dead network is NOT a stale module graph: the chunk failed because the
  // connection is gone, and a hard reload would just tear down the running app
  // (losing SPA state) for the same failure. Let the ErrorBoundary show its
  // connection message instead; the user retries once they are back on.
  if (navigator.onLine === false) return false;
  const key = `${VITE_CHUNK_KEY}:${window.location.pathname}`;
  const attempts = parseInt(safeSessionStorage.getItem(key) || '0', 10);
  if (attempts >= 3) {
    safeSessionStorage.removeItem(key); // exhausted — let the error surface
    return false;
  }
  safeSessionStorage.setItem(key, String(attempts + 1));
  // Hard navigation with cache-buster so the browser fetches fresh chunk URLs
  // instead of serving the stale cached response that caused the error. Set only
  // the _r param on a parsed URL so existing query params (?id=, ?tab=, and the
  // /join and /signer capability tokens) and any #hash survive the recovery reload.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.href = url.toString();
  return true;
};
window.addEventListener('error', (e) => handleStaleChunk(e.error, e.message));
window.addEventListener('unhandledrejection', (e) => {
  if (handleStaleChunk(e.reason, typeof e.reason === 'string' ? e.reason : '')) e.preventDefault();
});
// Vite native: fires when a preload link fails (stale hashed chunk after
// redeploy). Reload to fetch the new chunk manifest.
window.addEventListener('vite:preloadError', (e) => {
  if (handleStaleChunk(e.payload, '')) e.preventDefault();
});

// NOTE: there is no service worker any more. Offline mode was removed, and with
// it the caching worker that backed it. A browser that registered the old one
// keeps it until something unregisters it, so that (plus dropping its caches) is
// handled by lib/retiredOfflineQueue.js — deleting public/sw.js alone would have
// left existing installs serving a cached shell forever.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}