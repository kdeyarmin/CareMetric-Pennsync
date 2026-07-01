// Vitest setup shared by all component/integration tests.
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Raise the default async-utility budget (waitFor/findBy default is 1000ms). Heavy
// page mounts + their consolidated data fetches can exceed it when the full suite
// runs in parallel and saturates CPU, producing flakes that pass in isolation but
// fail intermittently under load on a constrained CI runner. A longer ceiling only
// DELAYS a wait — it can't mask a real failure (an assertion that never becomes
// true still fails), so this removes the load-induced timeouts without hiding
// regressions. Kept well under the vitest testTimeout so a test that does up to
// two sequential waitFor calls still finishes within its overall budget.
configure({ asyncUtilTimeout: 10000 });

// Unmount React trees between tests so the jsdom document stays clean, and reset
// the shared jsdom globals some specs mutate (offline flags, web storage) so no
// test can leak state into the next within a file.
afterEach(() => {
  cleanup();
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
