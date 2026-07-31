import { test } from '@playwright/test';
import { publicAccessibilityRoutes } from '../src/lib/accessibilitySmokeMatrix.js';
import { expectNoSeriousAxeViolations } from './axePlaywright.js';

/**
 * Public no-token routes from the accessibility smoke matrix.
 *
 * Run:
 *   pnpm run build && pnpm run test:a11y:e2e
 * Staging:
 *   PLAYWRIGHT_BASE_URL=https://staging.example pnpm run test:a11y:e2e
 *
 * Rules / tags / fail impacts: `src/lib/axeRules.js`
 * Playwright wiring: `e2e/axePlaywright.js`
 */
const routes = publicAccessibilityRoutes();

for (const entry of routes) {
  test(`axe: ${entry.route} (${entry.expectedNoCredentialState})`, async ({ page }) => {
    await page.goto(entry.route, { waitUntil: 'domcontentloaded' });
    // SPA routers need a beat to paint the no-token / public state.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(300);

    await expectNoSeriousAxeViolations(
      page,
      `${entry.route} [${entry.expectedNoCredentialState}]`,
    );
  });
}
