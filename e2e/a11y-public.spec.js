import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { publicAccessibilityRoutes } from '../src/lib/accessibilitySmokeMatrix.js';

/**
 * Public no-token routes from the accessibility smoke matrix.
 * Run: pnpm run test:a11y:e2e  (requires build + Playwright browsers)
 * Staging: PLAYWRIGHT_BASE_URL=https://staging.example pnpm run test:a11y:e2e
 */
const routes = publicAccessibilityRoutes();

for (const entry of routes) {
  test(`axe: ${entry.route} (${entry.expectedNoCredentialState})`, async ({ page }) => {
    await page.goto(entry.route, { waitUntil: 'domcontentloaded' });
    // Give SPA routers a beat to paint the no-token state.
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact),
    );

    if (serious.length > 0) {
      const summary = serious
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
        .join('\n');
      expect(serious, `Serious/critical axe violations on ${entry.route}:\n${summary}`).toEqual([]);
    }
  });
}
