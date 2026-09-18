// No Auth/API stack, passwords or real user state. Actual Chromium negative tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startBrowserServer, BROWSER_ORIGIN } from './server.mjs';
import { allowedDestination, matchesPatientPost } from './network.mjs';
import { API } from '../../authority-store/tests/http-local-stack.mjs';

test('patient delay and failure hooks exclude OPTIONS and unrelated requests', () => {
  for (const path of ['/pennsync_staging_patient', '/pennsync_staging_patients']) {
    const target = new URL(`${API}/rest/v1/rpc${path}`);
    assert.equal(matchesPatientPost(target, 'POST', path), true);
    for (const method of ['OPTIONS', 'GET', 'HEAD', 'DELETE']) {
      assert.equal(matchesPatientPost(target, method, path), false);
    }
    assert.equal(matchesPatientPost(new URL(`${BROWSER_ORIGIN}/rest/v1/rpc${path}`), 'POST', path), false);
    assert.equal(matchesPatientPost(new URL(`${API}/rest/v1/rpc/pennsync_staging_context`), 'POST', path), false);
    assert.equal(matchesPatientPost(new URL(`${target}?unexpected=true`), 'POST', path), false);
  }
});

test('browser boundary blocks Base44 and undeclared resources before delivery', { timeout: 30000 }, async () => {
  let stop, browser;
  try {
    stop = await startBrowserServer({ actors: [], target: {} });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let blocked = 0, errors = 0;
    await context.route('**/*', async route => {
      if (!allowedDestination(new URL(route.request().url()), route.request().method())) {
        blocked += 1; await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', () => { errors += 1; });
    await page.goto(BROWSER_ORIGIN); await expect(page.locator('#status')).toHaveText('Signed out');
    await page.locator('#load').click(); await expect(page.locator('#status')).toHaveText('AUTHENTICATION_REQUIRED');
    assert.equal(blocked, 0); assert.equal(errors, 0);
    // Intentional negative probes only in this separate credential-free test;
    // the real Auth acceptance test requires zero forbidden attempts.
    for (const url of ['https://api.base44.com/__pennsync_forbidden_probe__',
      'https://caremetricai.base44.app/__pennsync_forbidden_probe__',
      `${BROWSER_ORIGIN}/package.json`]) {
      assert.equal(await page.evaluate(async target => {
        try { await fetch(target); return false; } catch { return true; }
      }, url), true);
    }
    assert.equal(blocked, 3);
    assert.equal((await fetch(`${BROWSER_ORIGIN}/package.json`)).status, 404);
    assert.equal((await fetch(`${BROWSER_ORIGIN}/configuration`, { method: 'POST' })).status, 404);
    await context.close();
  } finally { if (browser) await browser.close(); if (stop) await stop(); }
});
