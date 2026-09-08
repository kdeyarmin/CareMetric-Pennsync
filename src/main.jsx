// Self-host the Inter variable font (weight axis 100–900) instead of fetching it
// from the Google Fonts CDN. Vite bundles the woff2, so the app keeps its
// typography with no third-party request — better for HIPAA posture and for
// slow connections. The @font-face family it declares is 'Inter Variable' (see
// tailwind.config.js fontFamily.sans).
import '@fontsource-variable/inter'
import '@/index.css'
import '@/styles/button-contrast.css'
import '@/styles/ipad.css'
import {
  closeAuthorityBoundWindows,
  installAuthorityBoundLinkInterceptor,
} from '@/lib/authorityBoundWindows'
import { installAuthorityBoundFileInputGuard } from '@/lib/authorityBoundFileInputs'
import { installAuthorityBoundFileDropGuard } from '@/lib/authorityBoundFileDrops'
import { poisonTenantSdkRealm } from '@/lib/tenantSdkRealmGate'
import { isBrowserAuthorityEpochStorageKey } from '@/lib/browserAuthorityEpoch'
import { installAuthorityBoundClipboard } from '@/lib/authorityBoundClipboard'
import { closePublicCapabilityRealm } from '@/lib/publicCapabilityRealmGate'

const authorityGuardCleanups = []

function scrubRetiredPublicTokenBeforeAppImport() {
  const segment = String(window.location.pathname || '').toLowerCase().split('/')[1] || ''
  if (segment !== 'signer' && segment !== 'followup') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('token')) return
  url.searchParams.delete('token')
  // Replace the whole entry state before React Router can retain either the
  // retired bearer or a stale clinical state object from session history.
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}

scrubRetiredPublicTokenBeforeAppImport()

function terminallyCloseDocumentAuthority() {
  try { poisonTenantSdkRealm() } catch { /* continue closing every realm */ }
  try { closePublicCapabilityRealm() } catch { /* continue closing native sinks */ }
  try { closeAuthorityBoundWindows() } catch { /* terminal close is best effort */ }
}

function currentFrameMayBootstrap() {
  try {
    if (window.top === window.self) return true
  } catch {
    return false
  }
  // There is no authenticated production editor handshake in this source
  // checkpoint. Do not expose a clinical DOM to an arbitrary parent frame.
  // Native WKWebView main frames have top === self and remain supported.
  return false
}

function renderSecureBootstrapBlocked() {
  const root = document.getElementById('root')
  if (!root) return
  const shell = document.createElement('main')
  shell.setAttribute('role', 'alert')
  shell.style.cssText = 'min-height:100vh;display:grid;place-items:center;background:#f8fafc;padding:24px;font-family:system-ui,sans-serif;color:#0f172a'
  const card = document.createElement('section')
  card.style.cssText = 'max-width:560px;border:1px solid #f59e0b;border-radius:16px;background:white;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)'
  const heading = document.createElement('h1')
  heading.textContent = 'Secure browser controls unavailable'
  heading.style.cssText = 'font-size:22px;font-weight:700;margin:0 0 12px'
  const message = document.createElement('p')
  message.textContent = 'PennSync did not open a clinical workspace because this browser could not install every required privacy boundary. Close this tab and try a supported, up-to-date browser.'
  message.style.cssText = 'font-size:15px;line-height:1.5;margin:0;color:#475569'
  card.append(heading, message)
  shell.append(card)
  root.replaceChildren(shell)
}

function installDocumentAuthorityGuards() {
  const pendingCleanups = []
  try {
    const installs = [
      installAuthorityBoundLinkInterceptor,
      installAuthorityBoundFileInputGuard,
      installAuthorityBoundFileDropGuard,
      installAuthorityBoundClipboard,
    ]
    for (const install of installs) {
      const cleanup = install()
      if (typeof cleanup !== 'function') {
        throw new Error('A required browser authority guard could not be installed')
      }
      pendingCleanups.push(cleanup)
    }
  } catch (error) {
    for (const cleanup of pendingCleanups.reverse()) {
      try { cleanup() } catch { /* keep rolling back partial installation */ }
    }
    terminallyCloseDocumentAuthority()
    throw error
  }

  // Close both raw realms before React effects or queued UI events when another
  // same-origin context changes any SDK token or authority marker. The Auth and
  // public providers perform their full state cleanup; this document listener
  // remains alive even if either React tree crashes or is temporarily unmounted.
  const closeOnAuthorityStorageTransition = (event) => {
    if (
      event.key === null
      || event.key === 'base44_access_token'
      || event.key === 'base44_pending_access_token'
      || event.key === 'token'
      || event.key === 'base44_app_id'
      || event.key === 'base44_server_url'
      || event.key === 'base44_functions_version'
      || isBrowserAuthorityEpochStorageKey(event.key)
    ) {
      terminallyCloseDocumentAuthority()
    }
  }
  try {
    window.addEventListener('storage', closeOnAuthorityStorageTransition)
  } catch (error) {
    for (const cleanup of pendingCleanups.reverse()) {
      try { cleanup() } catch { /* keep rolling back partial installation */ }
    }
    terminallyCloseDocumentAuthority()
    throw error
  }
  authorityGuardCleanups.push(...pendingCleanups)
}

let documentAuthorityReady = false
if (!currentFrameMayBootstrap()) {
  terminallyCloseDocumentAuthority()
  renderSecureBootstrapBlocked()
} else {
  try {
    installDocumentAuthorityGuards()
    documentAuthorityReady = true
  } catch {
    terminallyCloseDocumentAuthority()
    renderSecureBootstrapBlocked()
  }
}

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
  // /join and /consent capabilities) and any #hash survive the recovery reload.
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

// NOTE: there is no service worker any more. Offline mode was removed, and the
// source registers no replacement. `retiredBrowserCacheCleanup` independently
// attempts to unregister old workers and delete only their named caches without
// importing, replaying, migrating, or deleting legacy clinical queue records.

async function bootstrapApp() {
  // No application/React module is evaluated until every document-lifetime
  // native guard above has been installed and verified. This prevents an app
  // chunk or dependency from caching an unguarded browser method during ESM's
  // dependency-instantiation phase.
  const { installAlertToToastShim } = await import('@/lib/alert-shim')
  installAlertToToastShim()

  // The old queue/draft recovery module is intentionally quarantined because
  // its records predate exact tenant authority. Runtime cleanup cannot read or
  // mutate clinical work and may proceed independently after the guards exist.
  void import('@/lib/retiredBrowserCacheCleanup')
    .then(({ retireLegacyBrowserCaches }) => retireLegacyBrowserCaches())
    .catch(() => {})

  const [ReactModule, ReactDomModule, AppModule] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@/App.jsx'),
  ])
  const root = document.getElementById('root')
  if (!root) throw new Error('PennSync root element is unavailable')
  ReactDomModule.createRoot(root).render(
    ReactModule.createElement(
      ReactModule.StrictMode,
      null,
      ReactModule.createElement(AppModule.default),
    ),
  )
}

if (documentAuthorityReady) {
  void bootstrapApp().catch((error) => {
    if (handleStaleChunk(error, error?.message || '')) return
    terminallyCloseDocumentAuthority()
    renderSecureBootstrapBlocked()
  })
}

if (import.meta.hot) {
  const postHotUpdateToParent = (type) => {
    if (window.parent === window) return
    let parentOrigin = null
    try {
      parentOrigin = new URL(document.referrer).origin
    } catch {
      return
    }
    if (!/^https?:$/i.test(new URL(parentOrigin).protocol)) return
    window.parent.postMessage({ type }, parentOrigin)
  }
  import.meta.hot.on('vite:beforeUpdate', () => {
    postHotUpdateToParent('sandbox:beforeUpdate')
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    postHotUpdateToParent('sandbox:afterUpdate')
  });
}
