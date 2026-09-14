import { expect, test } from '@playwright/test';

// No accounts, patient data, or real provider operations are used here.
test('top-level public page starts with every privacy guard installed', async ({ page }) => {
  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
  await page.locator('h1').first().waitFor();
  const reason = await page.locator('[data-bootstrap-reason]').getAttribute('data-bootstrap-reason').catch(() => null);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' }),
    `Unexpected secure bootstrap block: ${reason || 'none'}`).toBeVisible();
});

test('embedded preview stays inert and opens a clean isolated tab', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.route('**/__preview_host', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Preview host</title></head><body><iframe title="App preview" src="/privacy?access_token=synthetic-test-only#discard"></iframe></body></html>',
  }));
  await page.goto('/__preview_host', { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { level: 1, name: 'Open a secure preview' })).toBeVisible();
  const link = frame.getByRole('link', { name: 'Open preview in a new tab' });
  await expect(link).toHaveAttribute('href', `${origin}/`);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(frame.locator('input[type="password"]')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  const opened = context.waitForEvent('page');
  await link.click();
  const newPage = await opened;
  await newPage.waitForLoadState('domcontentloaded');
  expect(new URL(newPage.url()).origin).toBe(origin);
  expect(newPage.url()).not.toContain('synthetic-test-only');
  expect(await newPage.evaluate(() => window.opener === null)).toBe(true);
  await newPage.close();
});

test('a failed native guard remains blocked and identifies the failed stage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'open', {
      value: () => null,
      configurable: false,
      writable: false,
    });
  });
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Secure browser controls unavailable' })).toBeVisible();
  await expect(page.getByText('Support code: LINK_GUARD')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload securely' })).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});
