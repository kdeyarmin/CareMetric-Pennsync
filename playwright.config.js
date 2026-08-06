import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for accessibility smokes (P2-02).
 *
 * axe-core is integrated via `@axe-core/playwright` in:
 *   - e2e/axePlaywright.js   (builder + expect helper)
 *   - e2e/a11y-public.spec.js (public matrix routes)
 * Shared tags/rules/fail impacts live in src/lib/axeRules.js.
 *
 * Default webServer: Vite preview after `pnpm build`.
 * Override with PLAYWRIGHT_BASE_URL for staging.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.js/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // package.json "preview" already binds 127.0.0.1:4173 with --strictPort.
        // Avoid `pnpm run preview -- --host…` — pnpm forwards a literal `--` into
        // vite argv and preview binds ::1 only, which breaks IPv4 health checks.
        command: 'pnpm run preview',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
