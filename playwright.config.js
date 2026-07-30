import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for accessibility smokes only (P2-02).
 * Default webServer targets local Vite preview after `pnpm build`.
 * Override with PLAYWRIGHT_BASE_URL for staging.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only start a local server when not pointed at an external URL.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm run preview -- --host 127.0.0.1 --port 4173',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
