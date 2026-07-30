/**
 * Playwright integration for axe-core.
 *
 * Uses the shared rule config from `src/lib/axeRules.js` so browser and
 * component scans stay aligned.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import {
  AXE_TAGS,
  AXE_BROWSER_DISABLED_RULES,
  filterFailingViolations,
  formatAxeViolations,
} from '../src/lib/axeRules.js';

/**
 * Build a configured AxeBuilder for the given Playwright page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ include?: string|string[], exclude?: string|string[] }} [opts]
 */
export function createAxeBuilder(page, opts = {}) {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);

  if (AXE_BROWSER_DISABLED_RULES.length > 0) {
    builder = builder.disableRules([...AXE_BROWSER_DISABLED_RULES]);
  }

  if (opts.include) {
    const list = Array.isArray(opts.include) ? opts.include : [opts.include];
    for (const sel of list) builder = builder.include(sel);
  }
  if (opts.exclude) {
    const list = Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude];
    for (const sel of list) builder = builder.exclude(sel);
  }

  return builder;
}

/**
 * Run axe on the page and return the full results object.
 * @param {import('@playwright/test').Page} page
 * @param {{ include?: string|string[], exclude?: string|string[] }} [opts]
 */
export async function analyzePageA11y(page, opts = {}) {
  return createAxeBuilder(page, opts).analyze();
}

/**
 * Assert no critical/serious axe violations on the current page.
 * Moderate/minor results are reported but do not fail the test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [label] context for the assertion message
 * @param {{ include?: string|string[], exclude?: string|string[] }} [opts]
 */
export async function expectNoSeriousAxeViolations(page, label = 'page', opts = {}) {
  const results = await analyzePageA11y(page, opts);
  const failing = filterFailingViolations(results.violations);

  if (failing.length > 0) {
    const summary = formatAxeViolations(failing);
    expect(failing, `Serious/critical axe violations on ${label}:\n${summary}`).toEqual([]);
  }

  return results;
}
