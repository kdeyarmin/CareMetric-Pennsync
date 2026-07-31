/**
 * Component-level axe helpers for *.a11y.test.jsx (Vitest + jsdom).
 *
 * Rule tags / disabled rules come from `src/lib/axeRules.js` so they stay
 * aligned with Playwright browser scans (`e2e/axePlaywright.js`).
 */
import { expect } from 'vitest';
import { axeRunOptions, filterFailingViolations, formatAxeViolations } from '@/lib/axeRules';

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
 * Run axe on a DOM container using shared jsdom rule config.
 * Soft-skips when vitest-axe is not installed.
 */
export async function expectNoAxeViolations(container, options = {}) {
  const { axeFn: axe, loadError: err } = await loadAxe();
  if (!axe) {
    console.warn('[a11y] vitest-axe not installed; skipping axe assertion.', err?.message || '');
    return { skipped: true };
  }

  const runOpts = axeRunOptions('jsdom', options);
  const results = await axe(container, runOpts);

  // Prefer impact-gated failures so component and browser gates match.
  const failing = filterFailingViolations(results.violations);
  if (failing.length > 0) {
    expect.fail(`Serious/critical axe violations:\n${formatAxeViolations(failing)}`);
  }

  return { skipped: false, results };
}
