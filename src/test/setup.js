// Vitest setup shared by all component/integration tests.
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { flushUnmountTimers } from './flushUnmountTimers.js';

// Raise the default async-utility budget (waitFor/findBy default is 1000ms). Heavy
// page mounts + their consolidated data fetches can exceed it when the full suite
// runs in parallel and saturates CPU, producing flakes that pass in isolation but
// fail intermittently under load on a constrained CI runner. A longer ceiling only
// DELAYS a wait — it can't mask a real failure (an assertion that never becomes
// true still fails), so this removes the load-induced timeouts without hiding
// regressions. Kept well under the vitest testTimeout so a test that does up to
// two sequential waitFor calls still finishes within its overall budget.
configure({ asyncUtilTimeout: 10000 });

// Unmount React trees between tests so the jsdom document stays clean, drain the
// macrotasks that unmounting queues, and reset the shared jsdom globals some
// specs mutate (offline flags, web storage) so no test can leak state into the
// next within a file.
afterEach(async () => {
  cleanup();
  // Let timers that unmount effects queued (notably Radix's focus-scope focus
  // restore) run while this file's jsdom window is still alive — see
  // ./flushUnmountTimers.js for what happens when one outlives it.
  await flushUnmountTimers();
  // Clearing localStorage also drops the shared browser authority epoch
  // (`pennsync_tenant_browser_authority_epoch_v1`), which every realm gate reads
  // as a rotation. `openTenantSdkRealm` compares against an epoch captured when
  // its module loaded, so a realm opened ONCE for a whole file is revoked here
  // and can never reopen — `open()` takes the external-transition path and
  // returns false. The symptom is a component that renders with no SDK access
  // from the second test onward, which reads exactly like the component failing
  // to construct the thing under test, and sends you to the component, where the
  // answer is not. Open the realm per test from a fresh module graph:
  // `vi.resetModules()`, then dynamic-import the gate AND the component from it.
  // `src/lib/authorityBoundFileDrops.spec.js` is the house pattern.
  try { localStorage.clear(); } catch { /* jsdom storage may be unavailable */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  // Some specs flip navigator.onLine via Object.defineProperty; restore the
  // default so an offline test never bleeds into a later online one.
  if (typeof navigator !== 'undefined' && navigator.onLine !== true) {
    try { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); } catch { /* ignore */ }
  }
});

// jsdom does not implement matchMedia; several components (theme, responsive
// helpers) call it. Provide a no-op so they can render under test.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
