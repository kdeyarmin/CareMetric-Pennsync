// The real src/main.jsx/App.jsx build, not the separate acceptance UI. No traces,
// screenshots, videos, HAR, console forwarding or persisted browser state files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import { localStatus, API } from '../../authority-store/tests/http-local-stack.mjs';
import { STAGING_APP_ID as APP, AUTHORITY_CONTRACT } from '../client.mjs';
import { BRAND_LOGO_URL } from '../../../src/lib/brand.js';
import { provision, localRequest } from './fixture.mjs';
import { allowedDestination, matchesPatientPost } from './network.mjs';
import { startActualApp, ACTUAL_APP_ORIGIN } from './actual-app-server.mjs';
import { createRouteWorkTracker, settlePageRoutes } from './route-work.mjs';
// Existing public brand asset. This is the one retained remote static dependency,
// not evidence of complete hosting exit. Do not allow its bucket or host broadly.
const LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png';
const ROSTERS = [
  ['admin-a', ['Synthetic Patient A1', 'Synthetic Patient A2']],
  ['clinician-a', ['Synthetic Patient A1']], ['clinician-empty', []],
  ['admin-b', ['Synthetic Patient B1']],
];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('ACTUAL_APP_RACE_TIMEOUT')), 15000);
  })]); } finally { clearTimeout(timer); }
};
function allowedRequest(url, method, resourceType, assetPaths) {
  if (url.username || url.password || url.hash) return false;
  if (url.href === LOGO) return method === 'GET' && resourceType === 'image';
  if (url.origin === ACTUAL_APP_ORIGIN) return method === 'GET'
    && ((!url.search && (assetPaths.has(url.pathname) || (resourceType === 'document' && ['/', '/Patients', '/consent'].includes(url.pathname))))
      || (resourceType === 'document' && url.pathname === '/consent' && url.search === '?ctx=synthetic-unavailable'));
  return url.origin === API && allowedDestination(url, method)
    && url.pathname !== '/rest/v1/rpc/pennsync_staging_patient';
}
function containsCredential(value, secrets) {
  const serialized = JSON.stringify(value);
  return secrets.some(secret => typeof secret === 'string' && secret.length > 0 && serialized.includes(secret))
    || /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/.test(serialized)
    || /sb_secret_[A-Za-z0-9_-]+/.test(serialized);
}
function publicCdnCookie(cookie) {
  return cookie.name === '__cf_bm' && cookie.domain === 'supabase.co' && cookie.path === '/'
    && cookie.httpOnly === true && cookie.secure === true && cookie.sameSite === 'None';
}

test('actual app network and credential checks exclude remote business calls and secret persistence', () => {
  assert.equal(BRAND_LOGO_URL, LOGO);
  const assets = new Set(['/assets/app.js', '/assets/app.css']);
  const allowed = (url, method = 'GET', type = 'fetch') => allowedRequest(new URL(url), method, type, assets);
  assert.equal(allowed(`${ACTUAL_APP_ORIGIN}/`, 'GET', 'document'), true);
  assert.equal(allowed(`${ACTUAL_APP_ORIGIN}/assets/app.js`, 'GET', 'script'), true);
  assert.equal(allowed(LOGO, 'GET', 'image'), true);
  for (const [url, method, type] of [[LOGO, 'GET', 'fetch'], [LOGO, 'POST', 'image'],
    [`${LOGO}?other=true`, 'GET', 'image'], ['https://api.base44.com/', 'GET', 'fetch'],
    ['https://caremetricai.base44.app/', 'GET', 'document'], [`${ACTUAL_APP_ORIGIN}/package.json`, 'GET', 'fetch'],
    [`${ACTUAL_APP_ORIGIN}/assets/not-emitted.js`, 'GET', 'script'], [`${ACTUAL_APP_ORIGIN}/`, 'POST', 'document'],
    ['http://127.0.0.1:4179/', 'GET', 'document'], [`${API}/rest/v1/rpc/pennsync_staging_patient`, 'POST', 'fetch'],
    [`${API}/rest/v1/rpc/pennsync_staging_patients?unexpected=1`, 'POST', 'fetch']]) {
    assert.equal(allowed(url, method, type), false);
  }
  assert.equal(allowed(`${API}/rest/v1/rpc/pennsync_staging_patients`, 'POST'), true);
  assert.equal(allowed(`${API}/auth/v1/token?grant_type=password`, 'POST'), true);
  assert.equal(containsCredential({ base44_app_id: APP, authority_marker: 'closed' }, ['password-sentinel']), false);
  for (const secret of ['password-sentinel', 'access-sentinel', 'refresh-sentinel']) {
    assert.equal(containsCredential({ arbitrary: { nested: secret } }, [secret]), true);
  }
  assert.equal(containsCredential({ arbitrary: 'eyJ123456.abcdefghi.abcdefgh' }, []), true);
  const cdn = { name: '__cf_bm', domain: 'supabase.co', path: '/', httpOnly: true, secure: true, sameSite: 'None' };
  assert.equal(publicCdnCookie(cdn), true);
  for (const patch of [{ name: 'access_token' }, { domain: '127.0.0.1' }, { domain: 'other.supabase.co' },
    { path: '/auth' }, { httpOnly: false }, { secure: false }, { sameSite: 'Lax' }]) {
    assert.equal(publicCdnCookie({ ...cdn, ...patch }), false);
  }
});

test('compiled app login, explicit agency, four rosters and logout use real owned local Auth/API', { timeout: 240000 }, async t => {
  // Debug mode can print password fill arguments. Refuse before users/passwords exist.
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('ACTUAL_APP_DEBUG_OUTPUT_FORBIDDEN');
  let phase = 'owned-stack';
  let db, browser, app, context, actors, page;
  let blocked = 0, pageErrors = 0, routeErrors = 0, databaseErrors = 0, apiRequests = 0, publicImages = 0;
  let evidenceCheck = 'none';
  const routeFailures = { request: 0, imageCredentials: 0, imageFetch: 0, imageResponse: 0, imageFulfill: 0,
    grantFetch: 0, grantContract: 0, grantFulfill: 0, logoutFetch: 0, logoutResponse: 0, logoutFulfill: 0,
    rosterFetch: 0, rosterContract: 0, continue: 0 };
  const routeTrackers = new WeakMap();
  let hold = null, holdLogout = null;
  const credentials = [], releases = [], grants = new Map(), knownGrants = new Set();
  let status;
  try {
    assert.equal(BRAND_LOGO_URL, LOGO);
    status = await localStatus();
    const { Client } = createRequire(new URL('../../authority-store/package.json', import.meta.url))('pg');
    db = new Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
    db.on('error', () => { databaseErrors += 1; });
    await db.connect();
    phase = 'native-users-and-fixtures';
    const prepared = await provision(db, status); actors = prepared.actors;
    credentials.push(...actors.map(actor => actor.password), status.SECRET_KEY);
    phase = 'compiled-app-build'; app = await startActualApp(prepared.configuration);
    browser = await chromium.launch({ headless: true });
    const newContext = async () => {
      const value = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      const tracker = createRouteWorkTracker(); routeTrackers.set(value, tracker);
      value.on('page', currentPage => currentPage.on('pageerror', () => { pageErrors += 1; }));
      await value.routeWebSocket('**/*', socket => { blocked += 1; socket.close(); });
      await value.route('**/*', route => tracker.track(async () => {
        let pending;
        let routePhase = 'request';
        try {
          const request = route.request(), url = new URL(request.url()), headers = request.headers();
          if (!allowedRequest(url, request.method(), request.resourceType(), app.assetPaths)) {
            blocked += 1; await route.abort('blockedbyclient'); return;
          }
          if (url.href === LOGO) {
            routePhase = 'imageCredentials';
            // The existing public image alone may leave loopback, without credentials.
            if (headers.authorization || headers.apikey || (headers.cookie && !/^__cf_bm=[^;\r\n]+$/.test(headers.cookie))
              || containsCredential({ cookie: headers.cookie }, credentials)) throw new Error('ACTUAL_APP_IMAGE_CREDENTIALS');
            // Preserve the genuine CDN response, including its benign __cf_bm
            // protection cookie. It is not a PennSync Auth credential. Redirects
            // remain disabled; only this exact public PNG is permitted remotely.
            routePhase = 'imageFetch';
            const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
            routePhase = 'imageResponse';
            assert.equal(response.status(), 200);
            assert.match(response.headers()['content-type'] || '', /^image\/png\b/i);
            publicImages += 1; routePhase = 'imageFulfill'; await route.fulfill({ response }); return;
          }
          if (url.origin === API) {
            apiRequests += 1;
            assert.equal(headers.cookie, undefined);
            if (request.method() !== 'OPTIONS' && headers.apikey !== status.PUBLISHABLE_KEY) {
              blocked += 1; await route.abort('blockedbyclient'); return;
            }
            if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
              // Observe the genuine grant only in Node memory so persistence checks
              // cover both access and refresh tokens, without saving any auth response.
              routePhase = 'grantFetch';
              const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
              routePhase = 'grantContract';
              assert.equal(response.status(), 200);
              const grant = await response.json();
              // A real successful grant belongs to this test's sign-in attempt.
              // Retain cleanup before validating its claimed identity so a bad
              // provider response cannot strand a newly created native session.
              if (typeof grant.access_token === 'string' && grant.access_token) {
                knownGrants.add(grant.access_token); credentials.push(grant.access_token);
              }
              if (typeof grant.refresh_token === 'string') credentials.push(grant.refresh_token);
              const actor = actors.find(item => item.email === request.postDataJSON().email);
              assert.ok(actor); assert.equal(grant.user.id, actor.uuid); assert.equal(grant.user.email, actor.email);
              assert.match(grant.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
              assert.equal(typeof grant.refresh_token, 'string'); assert.ok(grant.refresh_token.length > 0);
              grants.set(actor.name, grant.access_token);
              routePhase = 'grantFulfill'; await route.fulfill({ response }); return;
            }
            if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') {
              routePhase = 'logoutFetch';
              const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
              routePhase = 'logoutResponse';
              assert.equal(response.status(), 204);
              knownGrants.delete((headers.authorization || '').replace(/^Bearer /, ''));
              if (holdLogout) {
                pending = holdLogout; holdLogout = null;
                pending.arrived.resolve(); await pending.release.promise;
              }
              routePhase = 'logoutFulfill'; await route.fulfill({ response }); pending?.finished.resolve(); return;
            }
            if (hold && matchesPatientPost(url, request.method(), '/pennsync_staging_patients')) {
              pending = hold; hold = null;
              routePhase = 'rosterFetch';
              const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
              routePhase = 'rosterContract';
              assert.equal(response.status(), 200);
              const result = await response.json(), actor = actors.find(item => item.name === 'admin-a');
              assert.equal(headers.authorization, `Bearer ${grants.get('admin-a')}`);
              assert.deepEqual(request.postDataJSON(), { p_app_id: APP, p_agency_id: 'agency-a', p_limit: 50, p_after_id: null });
              const common = { contract: AUTHORITY_CONTRACT, app_id: APP, auth_user_id: actor.uuid, staging: true, synthetic: true };
              for (const [key, expected] of Object.entries(common)) {
                assert.equal(result[key], expected); assert.equal(result.context[key], expected);
              }
              assert.equal(result.context.user_id, actor.legacyId); assert.equal(result.context.user_email, actor.email);
              assert.equal(result.context.agency_id, 'agency-a'); assert.equal(result.context.membership_id, 'membership-admin-a');
              assert.equal(result.context.membership_version, 1); assert.equal(result.context.tenant_role, 'agency_admin');
              assert.deepEqual(Object.keys(result).sort(), [...Object.keys(common), 'context', 'items', 'next_cursor'].sort());
              assert.deepEqual(result.items, ['a1', 'a2'].map(id => ({ id: `patient-${id}`, agency_id: 'agency-a',
                display_name: `Synthetic Patient ${id.toUpperCase()}`, version: 1, synthetic: true })));
              assert.equal(result.next_cursor, null);
              pending.arrived.resolve(); await pending.release.promise;
              // This is the original real signed success. Cancellation after logout
              // is expected; an obsolete continuation must never reopen the roster.
              await route.fulfill({ response }).catch(() => {});
              pending.finished.resolve(); return;
            }
          }
          routePhase = 'continue'; await route.continue();
        } catch {
          routeFailures[routePhase] += 1;
          routeErrors += 1; pending?.arrived.resolve(); pending?.finished.resolve();
          await route.abort('failed').catch(() => {});
        }
      }));
      return value;
    };
    context = await newContext(); page = await context.newPage(); page.setDefaultTimeout(10000);
    const names = () => page.getByRole('heading', { level: 3, name: /^Synthetic Patient / });
    const noPersistedCredentials = async () => {
      // App parameters and authority tombstones are legitimate. Inspect credentials,
      // not the existence of storage. These snapshots never leave Node memory.
      evidenceCheck = 'browser-storage-snapshot';
      const stored = await context.storageState({ indexedDB: true });
      const session = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
      evidenceCheck = 'persisted-credential-denial';
      assert.equal(containsCredential([stored, session], credentials), false);
      evidenceCheck = 'public-cdn-cookie-contract';
      assert.equal(stored.cookies.every(publicCdnCookie), true);
      evidenceCheck = 'empty-cache-storage';
      assert.equal(await page.evaluate(async () => (await globalThis.caches.keys()).length), 0);
      evidenceCheck = 'none';
    };
    const signedOut = async () => {
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.getByRole('heading', { name: 'Patient Management', exact: true })).toHaveCount(0);
      await expect(names()).toHaveCount(0); await noPersistedCredentials();
    };
    const chooseAgency = async name => {
      const label = name === 'admin-b' ? 'Synthetic Agency B' : 'Synthetic Agency A';
      await page.getByRole('button', { name: new RegExp(label) }).click();
      await expect(page.getByRole('heading', { name: 'Patient Management', exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).pathname, '/Patients');
    };
    const login = async (name, select = true) => {
      const actor = actors.find(item => item.name === name);
      await page.getByLabel('Email', { exact: true }).fill(actor.email);
      await page.getByLabel('Password', { exact: true }).fill(actor.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Choose the agency workspace to open', exact: true })).toBeVisible();
      await expect(names()).toHaveCount(0); await noPersistedCredentials();
      if (select) await chooseAgency(name);
    };
    const roster = async expected => {
      if (!expected.length) await expect(page.getByRole('heading', { name: 'No assigned patients', exact: true })).toBeVisible();
      await expect(names()).toHaveText(expected);
      await expect(page.getByRole('button', { name: 'Add Patient', exact: true })).toHaveCount(0);
      const details = page.getByRole('button', { name: 'View Details', exact: true });
      await expect(details).toHaveCount(expected.length);
      for (let i = 0; i < expected.length; i++) await expect(details.nth(i)).toBeDisabled();
      await noPersistedCredentials();
    };
    const logout = async () => {
      const response = page.waitForResponse(value => value.url() === `${API}/auth/v1/logout?scope=local`
        && value.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(names()).toHaveCount(0); assert.equal((await response).status(), 204);
      await signedOut();
      assert.equal((await db.query('select count(*)::int as n from auth.sessions')).rows[0].n, 0);
    };
    await page.goto(ACTUAL_APP_ORIGIN); await signedOut();
    phase = 'four-actual-app-role-rosters';
    for (const [name, expected] of ROSTERS) {
      phase = `${name}-login`; await login(name);
      phase = `${name}-roster`; await roster(expected);
      phase = `${name}-logout`; await logout();
    }
    t.diagnostic('Compiled App: four native logins, explicit agency selection, exact scoped name rosters, disabled clinical actions and logout passed.');

    phase = 'online-terminal-reset-native-cleanup';
    await login('admin-a'); await roster(['Synthetic Patient A1', 'Synthetic Patient A2']);
    const resetBearer = grants.get('admin-a');
    const reset = { arrived: deferred(), release: deferred(), finished: deferred() };
    holdLogout = reset; releases.push(reset.release);
    const resetResponse = page.waitForResponse(value => value.url() === `${API}/auth/v1/logout?scope=local`
      && value.request().method() === 'POST');
    await page.evaluate(() => globalThis.dispatchEvent(new globalThis.Event('online')));
    await bounded(reset.arrived.promise); assert.equal(routeErrors, 0);
    await expect(names()).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toHaveCount(0);
    assert.equal((await db.query('select count(*)::int as n from auth.sessions')).rows[0].n, 0);
    const resetDenied = await localRequest('/rest/v1/rpc/pennsync_staging_patients', status.PUBLISHABLE_KEY,
      { p_app_id: APP, p_agency_id: 'agency-a', p_limit: 50, p_after_id: null }, resetBearer);
    assert.equal(resetDenied.status, 403); assert.equal((await resetDenied.json()).code, '28000');
    reset.release.resolve(); await bounded(reset.finished.promise); assert.equal((await resetResponse).status(), 204);
    await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible();
    await settlePageRoutes(page, routeTrackers.get(context));
    await page.getByRole('button', { name: 'Reload app', exact: true }).click(); await signedOut();
    t.diagnostic('Online terminal reset removed the roster, revoked its native session and waited for genuine logout confirmation before offering controlled Reload.');

    phase = 'delayed-genuine-roster-logout';
    await login('admin-a', false);
    const pending = { arrived: deferred(), release: deferred(), finished: deferred() };
    hold = pending; releases.push(pending.release);
    await chooseAgency('admin-a'); await bounded(pending.arrived.promise);
    assert.equal(routeErrors, 0); await expect(names()).toHaveCount(0);
    const oldBearer = grants.get('admin-a'); assert.ok(oldBearer);
    await logout();
    phase = 'revoked-native-session-and-obsolete-roster';
    const old = await localRequest('/rest/v1/rpc/pennsync_staging_patients', status.PUBLISHABLE_KEY,
      { p_app_id: APP, p_agency_id: 'agency-a', p_limit: 50, p_after_id: null }, oldBearer);
    assert.equal(old.status, 403); assert.equal((await old.json()).code, '28000');
    pending.release.resolve(); await bounded(pending.finished.promise); await signedOut();
    // The next principal must see only its own agency after the old response settles.
    await login('admin-b'); await roster(['Synthetic Patient B1']); await logout();
    t.diagnostic('A genuine delayed roster stayed closed after logout; its still-signed JWT was denied by native session revocation, and the next agency stayed isolated.');

    phase = 'settle-before-fresh-context';
    await settlePageRoutes(page, routeTrackers.get(context));
    phase = 'fresh-context-open';
    await context.close(); context = await newContext(); page = await context.newPage(); page.setDefaultTimeout(10000);
    phase = 'fresh-context-signed-out';
    await page.goto(`${ACTUAL_APP_ORIGIN}/Patients`); await signedOut();
    phase = 'settle-before-public-consent';
    await settlePageRoutes(page, routeTrackers.get(context));
    const beforePublic = apiRequests;
    phase = 'public-consent-unavailable';
    await page.goto(`${ACTUAL_APP_ORIGIN}/consent?ctx=synthetic-unavailable`);
    await expect(page.getByRole('heading', { name: 'This secure link is unavailable in independent staging', exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).search, '');
    phase = 'public-consent-no-api-or-roster';
    assert.equal(apiRequests, beforePublic); await expect(names()).toHaveCount(0); await noPersistedCredentials();
    phase = 'settle-before-network-evidence';
    await settlePageRoutes(page, routeTrackers.get(context));
    phase = 'network-evidence-counters';
    assert.equal(blocked, 0); assert.equal(pageErrors, 0); assert.equal(routeErrors, 0); assert.equal(databaseErrors, 0);
    phase = 'required-api-and-public-image-evidence';
    assert.ok(apiRequests > 30); assert.ok(publicImages > 0);
    phase = 'native-user-and-session-counts';
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 4);
    assert.equal((await db.query('select count(*)::int as n from auth.sessions')).rows[0].n, 0);
    phase = 'local-mail-sink-count';
    const mail = await fetch('http://127.0.0.1:54324/api/v1/info', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(mail.ok, true); assert.equal((await mail.json()).Messages, 0);
    t.diagnostic('Zero Base44 business or other undeclared network attempts, page errors, persisted credentials, native sessions or outgoing mail. The exact public logo GET and identified CDN protection cookie remain allowed.');
  } catch {
    // Playwright and Auth failures may contain fill arguments or tokens. Emit only
    // a fixed phase; do not attach the original message, call log, output or cause.
    // Only hard-coded labels and aggregate integers leave this test. Never print
    // a URL, request/response body, header, storage value or caught error.
    t.diagnostic(`Safe evidence counters: ${JSON.stringify({ blocked, pageErrors, routeErrors, databaseErrors,
      apiRequests, publicImages, evidenceCheck, routeFailures })}`);
    throw new Error(`ACTUAL_APP_ACCEPTANCE_FAILED_${phase.toUpperCase().replaceAll('-', '_')}`);
  } finally {
    for (const release of releases) release.resolve();
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (app) await app.stop().catch(() => {});
    if (actors) for (const actor of actors) actor.password = null;
    await (async () => {
      let cleanupFailed = false;
      for (const token of knownGrants) {
        try {
          const response = await localRequest('/auth/v1/logout?scope=local', status.PUBLISHABLE_KEY, {}, token);
          if (response.status !== 204) cleanupFailed = true;
        } catch { cleanupFailed = true; }
      }
      knownGrants.clear(); credentials.length = 0; grants.clear();
      if (db) await db.end().catch(() => { cleanupFailed = true; });
      if (cleanupFailed) throw new Error('ACTUAL_APP_KNOWN_SESSION_CLEANUP_FAILED');
    })();
  }
});
