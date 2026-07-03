import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
// Self-host the Inter variable font (weight axis 100–900) instead of fetching it
// from the Google Fonts CDN. Vite bundles the woff2, so the app keeps its
// typography with no third-party request — better for offline mode and HIPAA
// posture. The @font-face family it declares is 'Inter Variable' (see
// tailwind.config.js fontFamily.sans).
import '@fontsource-variable/inter'
import '@/index.css'
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

const safeLocalStorage = safeStorage(window.localStorage);
const safeSessionStorage = safeStorage(window.sessionStorage);

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
const handleStaleChunk = (err) => {
  const isStaleChunk = err?.name === 'TypeError' &&
    /dynamically imported module/i.test(err?.message || '');
  if (!isStaleChunk) return false;
  // Offline is NOT a stale module graph: the chunk failed because the network
  // is gone, and a hard reload while offline just tears down the running app
  // (losing SPA state) for the same failure. Let the ErrorBoundary show its
  // offline message instead; the user retries after reconnecting.
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
window.addEventListener('error', (e) => handleStaleChunk(e.error));
window.addEventListener('unhandledrejection', (e) => {
  if (handleStaleChunk(e.reason)) e.preventDefault();
});

// Register the offline service worker (public/sw.js): network-first app shell
// with an offline fallback, cache-first hashed /assets/ chunks, and the
// font/image cache with PHI-exclusion rules. Production only — the dev server
// serves unhashed source modules the worker's caching policy doesn't apply to,
// and a worker left controlling localhost masks dev-server restarts.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure (private mode, unsupported embedder) just means
      // no offline cache — the app itself still runs normally.
    });
  });
}

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