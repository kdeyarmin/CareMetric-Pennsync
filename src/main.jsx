import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { installAlertToToastShim } from '@/lib/alert-shim'

// Surface legacy window.alert() notifications as on-brand toasts.
installAlertToToastShim()

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
  const key = `${VITE_CHUNK_KEY}:${window.location.pathname}`;
  if (sessionStorage.getItem(key)) {
    sessionStorage.removeItem(key); // already retried — let the error surface
    return false;
  }
  sessionStorage.setItem(key, '1');
  window.location.reload();
  return true;
};
window.addEventListener('error', (e) => handleStaleChunk(e.error));
window.addEventListener('unhandledrejection', (e) => {
  if (handleStaleChunk(e.reason)) e.preventDefault();
});

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