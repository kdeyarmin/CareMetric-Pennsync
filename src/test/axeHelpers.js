/**
 * Optional axe helpers for *.a11y.test.jsx files.
 *
 * vitest-axe is a new optional dependency. Until pnpm-lock.yaml is refreshed
 * (via the update-lockfile workflow or a local pnpm install), these helpers
 * skip rather than failing the whole component suite.
 */
import { expect } from 'vitest';

let axeFn = null;
let loaded = false;
let loadError = null;

async function loadAxe() {
  if (loaded) return { axeFn, loadError };
  loaded = true;
  try {
    const mod = await import('vitest-axe');
    const matchers = await import('vitest-axe/matchers');
    expect.extend(matchers);
    axeFn = mod.axe;
  } catch (err) {
    loadError = err;
    axeFn = null;
  }
  return { axeFn, loadError };
}

/**
 * Run axe on a DOM container. Skips the test when vitest-axe is not installed.
 * color-contrast is disabled under jsdom by default.
 */
export async function expectNoAxeViolations(container, options = {}) {
  const { axeFn: axe, loadError: err } = await loadAxe();
  if (!axe) {
    // Soft-skip: dependency not on the lockfile yet.
    // eslint-disable-next-line no-console
    console.warn('[a11y] vitest-axe not installed; skipping axe assertion.', err?.message || '');
    return { skipped: true };
  }
  const results = await axe(container, {
    rules: { 'color-contrast': { enabled: false }, ...(options.rules || {}) },
    ...options,
  });
  expect(results).toHaveNoViolations();
  return { skipped: false, results };
}
