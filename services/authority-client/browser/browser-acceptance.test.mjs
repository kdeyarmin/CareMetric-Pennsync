// Real Chromium + owned local Auth/API. No traces, screenshots, videos or HAR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import { localStatus, API } from '../../authority-store/tests/http-local-stack.mjs';
import { STAGING_APP_ID as APP, AUTHORITY_CONTRACT } from '../client.mjs';
import { provision, localRequest } from './fixture.mjs';
import { startBrowserServer, BROWSER_ORIGIN } from './server.mjs';
import { allowedDestination, matchesPatientPost } from './network.mjs';
const { Client } = createRequire(new URL('../../authority-store/package.json', import.meta.url))('pg');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('BROWSER_RACE_TIMEOUT')), 15000);
  })]); } finally { clearTimeout(timer); }
};

test('Chromium independent login and existing patient read contracts against real local Auth/API', { timeout: 180000 }, async t => {
  // Playwright debug output can include fill arguments; refuse before credentials exist.
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('BROWSER_DEBUG_OUTPUT_FORBIDDEN');
  let phase = 'owned-stack';
  let db, browser, stopServer, context, actors;
  let blocked = 0, pageErrors = 0, routeErrors = 0, requestCount = 0;
  let hold = null, fault = false, latestBearer = null;
  const releases = [];
  try {
    const status = await localStatus();
    db = new Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
    await db.connect();
    phase = 'native-users-and-independent-fixtures';
    const prepared = await provision(db, status); actors = prepared.actors;
    phase = 'isolated-browser-build'; stopServer = await startBrowserServer(prepared.configuration);
    browser = await chromium.launch({ headless: true });
    const newContext = async () => {
      const value = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      value.on('page', page => page.on('pageerror', () => { pageErrors += 1; }));
      await value.routeWebSocket('**/*', socket => { blocked += 1; socket.close(); });
      await value.route('**/*', async route => {
        try {
          const request = route.request(); const url = new URL(request.url());
          const localApi = url.origin === API;
          if (!allowedDestination(url, request.method())) { blocked += 1; await route.abort('blockedbyclient'); return; }
          if (localApi) {
            requestCount += 1;
            const headers = request.headers();
            if (request.method() !== 'OPTIONS' && headers.apikey !== status.PUBLISHABLE_KEY) {
              blocked += 1; await route.abort('blockedbyclient'); return;
            }
            if (headers.authorization?.startsWith('Bearer ')) latestBearer = headers.authorization.slice(7);
            if (matchesPatientPost(url, request.method(), '/pennsync_staging_patient') && fault) {
              fault = false; await route.abort('failed'); return;
            }
            if (hold && matchesPatientPost(url, request.method(), hold.path)) {
              const pending = hold; hold = null;
              const single = pending.path === '/pennsync_staging_patient';
              phase = single ? 'delayed-patient-http-response' : 'delayed-roster-http-response';
              // Delay only an actual signed request's real successful response.
              const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
              if (response.status() !== 200) throw new Error('BROWSER_REAL_RESPONSE_REQUIRED');
              phase = single ? 'delayed-patient-signed-identity' : 'delayed-roster-signed-identity';
              assert.match(headers.authorization || '', /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
              assert.match(response.headers()['content-type'] || '', /^application\/json\b/i);
              const result = await response.json();
              const expectedActor = actors.find(actor => actor.name === pending.actor);
              const common = { contract: AUTHORITY_CONTRACT, app_id: APP, auth_user_id: expectedActor.uuid,
                staging: true, synthetic: true };
              for (const [key, value] of Object.entries(common)) {
                assert.equal(result[key], value); assert.equal(result.context[key], value);
              }
              assert.equal(result.context.user_id, expectedActor.legacyId);
              assert.equal(result.context.user_email, expectedActor.email);
              assert.equal(result.context.agency_id, expectedActor.agency);
              assert.equal(result.context.membership_id, `membership-${expectedActor.name}`);
              assert.equal(result.context.membership_version, 1);
              assert.equal(result.context.tenant_role, 'agency_admin');
              const patient = { id: 'patient-a1', agency_id: 'agency-a', display_name: 'Synthetic Patient A1', version: 1, synthetic: true };
              phase = single ? 'delayed-patient-projection' : 'delayed-roster-projection';
              assert.deepEqual(Object.keys(result).sort(), [...Object.keys(common), 'context',
                ...(single ? ['patient'] : ['items', 'next_cursor'])].sort());
              assert.deepEqual(request.postDataJSON(), single
                ? { p_app_id: APP, p_agency_id: 'agency-a', p_patient_id: 'patient-a1' }
                : { p_app_id: APP, p_agency_id: 'agency-a', p_limit: 1, p_after_id: null });
              if (single) assert.deepEqual(result.patient, patient);
              else { assert.deepEqual(result.items, [patient]); assert.equal(result.next_cursor, 'patient-a1'); }
              pending.arrived.resolve(); await pending.release.promise;
              // Logout aborts the browser request. Either delivery is cancelled or
              // the client's epoch rejects it; neither may repopulate the UI.
              await route.fulfill({ response }).catch(() => {});
              pending.finished.resolve(); return;
            }
          }
          await route.continue();
        } catch { routeErrors += 1; await route.abort('failed').catch(() => {}); }
      });
      return value;
    };
    context = await newContext();
    let page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(BROWSER_ORIGIN); await expect(page.locator('#status')).toHaveText('Signed out');
    const login = async name => {
      const actor = actors.find(value => value.name === name);
      await page.locator('#actor').selectOption(name); await page.locator('#password').fill(actor.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Signed in');
      await expect(page.locator('#identity')).toHaveText(actor.email);
      await expect(page.locator('#password')).toHaveValue('');
      assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
      assert.deepEqual(await context.cookies(), []);
    };
    const logout = async () => {
      const response = page.waitForResponse(value => value.url() === `${API}/auth/v1/logout?scope=local`
        && value.request().method() === 'POST');
      await page.locator('#logout').click();
      await expect(page.locator('#identity')).toBeEmpty(); await expect(page.locator('#roster')).toBeEmpty();
      await expect(page.locator('#detail')).toBeEmpty();
      assert.equal((await response).status(), 204);
    };
    const roster = async expected => {
      await page.locator('#load').click();
      await expect(page.locator('#status')).toHaveText(expected.length ? 'Roster loaded' : 'No assigned patients');
      assert.deepEqual(await page.locator('#roster li').evaluateAll(items => items.map(item => item.dataset.patientId)), expected);
    };
    const detail = async id => { await page.locator('#patient-id').fill(id); await page.getByRole('button', { name: 'Open patient' }).click(); };
    const holdNext = path => {
      const pending = { path, actor: 'admin-a', arrived: deferred(), release: deferred(), finished: deferred() };
      hold = pending; releases.push(pending.release); return pending;
    };
    phase = 'four-role-browser-rosters';
    for (const [name, expected] of [['admin-a', ['patient-a1']], ['clinician-a', ['patient-a1']],
      ['clinician-empty', []], ['admin-b', ['patient-b1']]]) {
      await login(name); await roster(expected);
      if (name === 'admin-a') {
        await page.locator('#next').click(); await expect(page.locator('#roster li')).toHaveAttribute('data-patient-id', 'patient-a2');
        await expect(page.locator('#next')).toBeDisabled();
      } else await expect(page.locator('#next')).toBeDisabled();
      if (expected.length) {
        await detail(expected[0]); await expect(page.locator('#status')).toHaveText('Patient loaded');
        await expect(page.locator('#detail')).toHaveText(name === 'admin-b' ? 'Synthetic Patient B1' : 'Synthetic Patient A1');
      }
      if (name === 'clinician-a' || name === 'clinician-empty') {
        await detail(name === 'clinician-a' ? 'patient-a2' : 'patient-a1');
        await expect(page.locator('#status')).toHaveText('AUTHORITY_DENIED'); await expect(page.locator('#detail')).toBeEmpty();
      }
      await detail(name === 'admin-b' ? 'patient-a1' : 'patient-b1');
      await expect(page.locator('#status')).toHaveText('AUTHORITY_DENIED'); await expect(page.locator('#detail')).toBeEmpty();
      await logout();
    }
    t.diagnostic('Four native browser logins, scoped rosters/pagination and foreign patient denials passed.');

    phase = 'logout-delayed-genuine-patient';
    await login('admin-a'); await roster(['patient-a1']);
    const delayed = holdNext('/pennsync_staging_patient');
    await detail('patient-a1'); await bounded(delayed.arrived.promise);
    phase = 'logout-delayed-genuine-patient-revocation';
    const oldBearer = latestBearer; await logout(); delayed.release.resolve(); await bounded(delayed.finished.promise);
    await expect(page.locator('#status')).toHaveText('Signed out'); await expect(page.locator('#detail')).toBeEmpty();
    const old = await localRequest('/rest/v1/rpc/pennsync_staging_patient', status.PUBLISHABLE_KEY,
      { p_app_id: APP, p_agency_id: 'agency-a', p_patient_id: 'patient-a1' }, oldBearer);
    assert.equal(old.status, 403); assert.equal((await old.json()).code, '28000');
    await page.locator('#load').click(); await expect(page.locator('#status')).toHaveText('AUTHENTICATION_REQUIRED');
    t.diagnostic('Logout cleared visible state, rejected a genuine delayed response and revoked the native signed session.');

    phase = 'principal-switch-delayed-genuine-roster';
    await login('admin-a');
    const switched = holdNext('/pennsync_staging_patients');
    await page.locator('#load').click(); await bounded(switched.arrived.promise);
    phase = 'principal-switch-delayed-genuine-roster-delivery';
    await login('admin-b'); switched.release.resolve(); await bounded(switched.finished.promise);
    await expect(page.locator('#roster')).toBeEmpty(); await expect(page.locator('#detail')).toBeEmpty();
    await roster(['patient-b1']);
    await page.locator('#agency').fill('agency-a'); await page.locator('#load').click();
    await expect(page.locator('#status')).toHaveText('AUTHORITY_DENIED'); await expect(page.locator('#roster')).toBeEmpty();
    await page.locator('#agency').fill('agency-b');
    phase = 'failed-network-clears-old-detail';
    await detail('patient-b1'); await expect(page.locator('#detail')).toHaveText('Synthetic Patient B1');
    fault = true;
    await detail('patient-b1'); await expect(page.locator('#status')).toHaveText('AUTHORITY_NETWORK_FAILED');
    await expect(page.locator('#detail')).toBeEmpty(); await logout();

    phase = 'fresh-browser-context-no-persistence';
    assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
    assert.deepEqual(await context.cookies(), []);
    await context.close(); context = await newContext(); page = await context.newPage(); page.setDefaultTimeout(10000);
    await page.goto(BROWSER_ORIGIN); await expect(page.locator('#status')).toHaveText('Signed out');
    await expect(page.locator('#identity')).toBeEmpty(); await expect(page.locator('#roster')).toBeEmpty();
    await page.locator('#load').click(); await expect(page.locator('#status')).toHaveText('AUTHENTICATION_REQUIRED');
    t.diagnostic('Principal switch, network failure and fresh-context login requirements passed without persisted credentials.');

    phase = 'network-and-native-state-evidence';
    assert.equal(blocked, 0); assert.equal(pageErrors, 0); assert.equal(routeErrors, 0); assert.ok(requestCount > 30);
    const remaining = (await db.query('select count(*)::int as count from auth.sessions')).rows[0].count;
    assert.equal(remaining, 0);
    const mail = await fetch('http://127.0.0.1:54324/api/v1/info', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(mail.ok, true); assert.equal((await mail.json()).Messages, 0);
    t.diagnostic('Zero nonlocal/Base44 attempts, zero browser errors, zero remaining native sessions and zero outgoing mail.');
  } catch {
    // Never forward Playwright call logs (password fill), Auth data or request bodies.
    throw new Error(`BROWSER_ACCEPTANCE_FAILED_${phase.toUpperCase().replaceAll('-', '_')}`);
  } finally {
    for (const release of releases) release.resolve();
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (stopServer) await stopServer();
    if (actors) for (const actor of actors) actor.password = null;
    if (db) await db.end();
  }
});
