/**
 * Shared axe-core configuration for component (Vitest/jsdom) and browser
 * (Playwright) accessibility scans.
 *
 * Keep this module pure — no Playwright/Vitest imports — so both runners can
 * share the same tags, disabled rules, and fail thresholds.
 */

/** WCAG tags enforced on every scan. */
export const AXE_TAGS = Object.freeze([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
]);

/** Impacts that fail the test gate (warnings/moderate do not fail CI). */
export const AXE_FAIL_IMPACTS = Object.freeze(['critical', 'serious']);

/**
 * Rules disabled under jsdom. Color contrast and some spatial checks need a
 * real layout engine; jsdom cannot compute them reliably.
 */
export const AXE_JSDOM_DISABLED_RULES = Object.freeze([
  'color-contrast',
  'link-in-text-block',
]);

/**
 * Rules disabled in browser scans. Keep empty by default; add rule ids here
 * only with a documented product exception (and a follow-up ticket).
 */
export const AXE_BROWSER_DISABLED_RULES = Object.freeze([
  // Example (do not enable without review):
  // 'region', // some public shells lack <main> until layout lands
]);

/**
 * Build an axe-core `rules` map for the given environment.
 * @param {'browser' | 'jsdom'} env
 * @param {Record<string, { enabled?: boolean }>} [extra]
 */
export function axeRulesForEnvironment(env = 'browser', extra = {}) {
  const rules = { ...extra };
  const disabled =
    env === 'jsdom'
      ? [...AXE_JSDOM_DISABLED_RULES, ...AXE_BROWSER_DISABLED_RULES]
      : [...AXE_BROWSER_DISABLED_RULES];
  for (const id of disabled) {
    rules[id] = { enabled: false, ...(rules[id] || {}) };
  }
  return rules;
}

/** axe-core run options shared by both runners. */
export function axeRunOptions(env = 'browser', extra = {}) {
  return {
    runOnly: {
      type: 'tag',
      values: [...AXE_TAGS],
    },
    rules: axeRulesForEnvironment(env, extra.rules),
    resultTypes: ['violations', 'incomplete'],
    ...extra,
    // Ensure rules from env win over a shallow extra.rules spread above.
    ...(extra.rules
      ? { rules: axeRulesForEnvironment(env, extra.rules) }
      : {}),
  };
}

/** Violations that should fail the gate. */
export function filterFailingViolations(violations = []) {
  return (violations || []).filter((v) => AXE_FAIL_IMPACTS.includes(v.impact));
}

/** Human-readable multi-line summary for assertion messages. */
export function formatAxeViolations(violations = []) {
  return (violations || [])
    .map((v) => {
      const nodes = Array.isArray(v.nodes) ? v.nodes.length : 0;
      return `${v.id} (${v.impact}): ${v.help} — ${nodes} node(s)`;
    })
    .join('\n');
}
