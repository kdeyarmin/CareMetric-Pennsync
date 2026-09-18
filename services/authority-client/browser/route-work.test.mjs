// Actual Chromium and a real owned loopback PNG response; no Auth, credentials,
// provider API substitutes, public-network traffic, or recorded browser artifacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { createRouteWorkTracker, settlePageRoutes } from './route-work.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');

async function scenario({ settle, transition }) {
  const arrived = deferred(), release = deferred(), finished = deferred();
  const tracker = createRouteWorkTracker();
  let browser, blocked = 0, routeErrors = 0, delivered = 0, failedPhase = null;
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || !['/', '/next', '/logo.png'].includes(request.url)) {
      response.writeHead(404); response.end(); return;
    }
    if (request.url === '/logo.png') {
      arrived.resolve(); await release.promise;
      response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(PNG); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><link rel="icon" href="data:,"><p>Ready</p>');
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => tracker.track(async () => {
      let phase = 'request';
      try {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== 'GET' || url.search
          || !['/', '/next', '/logo.png'].includes(url.pathname)) {
          blocked += 1; await route.abort('blockedbyclient'); return;
        }
        if (url.pathname !== '/logo.png') { await route.continue(); return; }
        phase = 'image-fetch';
        const response = await route.fetch({ maxRedirects: 0, timeout: 5000 });
        assert.equal(response.status(), 200); assert.equal(response.headers()['content-type'], 'image/png');
        phase = 'image-fulfill'; await route.fulfill({ response }); delivered += 1;
      } catch {
        routeErrors += 1; failedPhase = phase;
        await route.abort().catch(() => {});
      }
      finally { if (route.request().url() === `${origin}/logo.png`) finished.resolve(); }
    }));
    const page = await context.newPage(); await page.goto(origin);
    // Mirrors a login image mounted by React after logout, following document load.
    await page.evaluate(() => {
      const image = globalThis.document.createElement('img'); image.src = '/logo.png';
      globalThis.document.body.append(image);
    });
    await arrived.promise;
    if (settle) {
      let barrierDone = false;
      const barrier = settlePageRoutes(page, tracker).then(() => { barrierDone = true; });
      await page.evaluate(() => true); assert.equal(barrierDone, false);
      release.resolve(); await barrier;
      assert.equal(await page.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    }
    if (transition === 'close') await context.close();
    else await page.goto(`${origin}/next`);
    release.resolve(); await finished.promise; await tracker.drain();
    if (transition !== 'close') { await settlePageRoutes(page, tracker); await context.close(); }
    return { blocked, routeErrors, delivered, failedPhase };
  } finally {
    release.resolve(); if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

test('disposing a context before its genuine image route settles reproduces a false harness error', { timeout: 30000 }, async () => {
  const result = await scenario({ settle: false, transition: 'close' });
  assert.equal(result.blocked, 0); assert.equal(result.routeErrors, 1); assert.equal(result.delivered, 0);
  assert.ok(['image-fetch', 'image-fulfill'].includes(result.failedPhase));
});

test('route barrier completes the genuine image before close or navigation with the allowlist active', { timeout: 30000 }, async () => {
  for (const transition of ['close', 'navigate']) {
    assert.deepEqual(await scenario({ settle: true, transition }), { blocked: 0, routeErrors: 0, delivered: 1, failedPhase: null });
  }
});

test('route drain rejects a stalled handler at its deadline without retrying or discarding it', async () => {
  const release = deferred(), tracker = createRouteWorkTracker({ timeoutMs: 20 });
  let calls = 0;
  const operation = tracker.track(async () => { calls += 1; await release.promise; });
  try { await assert.rejects(tracker.drain(), { message: 'ACTUAL_APP_ROUTE_DRAIN_TIMEOUT' }); }
  finally { release.resolve(); await operation; }
  await tracker.drain(); assert.equal(calls, 1);
});
