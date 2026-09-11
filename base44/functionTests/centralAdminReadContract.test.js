import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTOR, AGENCY, NATIVE, STAFF, TOKEN, makeFixture, nativeModule, nativeRequest } from './centralAdminHarness.mjs';

async function result(fixture, body, options) {
  const response = await fixture.handler(nativeRequest(body, options));
  return { response, body: await response.json() };
}
for (const value of [undefined, '', 'false', 'TRUE', '1']) {
  test(`default-off configuration ${String(value)} never calls Hub or native SDK`, async () => {
    const fixture = makeFixture({ env: { CAREMETRIC_ADMIN_ENABLED: value } });
    assert.equal((await result(fixture)).response.status, 503);
    assert.equal(fixture.hubs.length + fixture.calls.length, 0);
  });
}
for (const [key, value] of [
  ['HUB_SUPABASE_PUBLISHABLE_KEY', 'service-secret'],
  ['CAREMETRIC_ADMIN_IDENTITY_MAP_JSON', '{}'],
  ['CAREMETRIC_ADMIN_IDENTITY_MAP_JSON', JSON.stringify({ 'not-a-uuid': NATIVE })],
  ['CAREMETRIC_ADMIN_IDENTITY_MAP_JSON', JSON.stringify({ [ACTOR]: 'native-user' })],
  ['CAREMETRIC_ADMIN_IDENTITY_MAP_JSON', JSON.stringify({ [ACTOR]: NATIVE.toUpperCase() })],
  ['CAREMETRIC_ADMIN_IDENTITY_MAP_JSON', JSON.stringify({ [ACTOR]: NATIVE, '22222222-2222-4222-8222-222222222222': NATIVE })],
]) {
  test(`malformed deployment ${key}:${value.slice(0, 18)} fails before network`, async () => {
    const fixture = makeFixture({ env: { [key]: value } });
    assert.equal((await result(fixture)).response.status, 503);
    assert.equal(fixture.hubs.length + fixture.calls.length, 0);
  });
}
for (const [options, expected] of [
  [{ method: 'GET' }, 405],
  [{ headers: { Origin: 'https://caremetricai.base44.app' } }, 403],
  [{ headers: { Origin: 'null' } }, 403],
  [{ headers: { Cookie: 'session=anything' } }, 403],
  [{ headers: { 'Content-Type': 'text/plain' } }, 415],
  [{ headers: { 'X-CareMetric-Hub-Authorization': null, Authorization: TOKEN } }, 401],
  [{ headers: { 'X-CareMetric-Hub-Authorization': 'Bearer notjwt' } }, 401],
  [{ rawBody: '{bad' }, 400],
  [{ rawBody: `{"operation":"overview","payload":"${'x'.repeat(2100)}"}` }, 400],
]) {
  test(`unsupported transport ${JSON.stringify(options).slice(0, 80)} denied`, async () => {
    const fixture = makeFixture();
    assert.equal((await result(fixture, undefined, options)).response.status, expected);
    assert.equal(fixture.hubs.length + fixture.requests.length, 0);
  });
}
for (const headers of [{ Origin: '' }, { Cookie: '' }, { Origin: ' ', Cookie: ' ' }]) {
  test(`empty proxy fields still require independent Hub authorization ${JSON.stringify(headers)}`, async () => {
    const fixture = makeFixture();
    const missing = await result(fixture, { operation: 'capabilities' }, { headers: { ...headers, 'X-CareMetric-Hub-Authorization': null } });
    assert.equal(missing.response.status, 401);
    assert.equal(fixture.hubs.length + fixture.requests.length, 0);
    const allowed = await result(fixture, { operation: 'capabilities' }, { headers });
    assert.equal(allowed.response.status, 200);
    assert.equal(fixture.hubs.length, 1);
    assert.equal(fixture.requests.length, 1);
  });
}
test('transport diagnostics report only closed categories and never change authorization rejection', async () => {
  const fixture = makeFixture();
  for (const [headers, expected] of [
    [{ Cookie: 'sensitive-session=secret' }, { origin: 'absent', cookie: 'present', originMatchesRequest: false, literalNullOrigin: false }],
    [{ Origin: 'https://caremetricai.base44.app' }, { origin: 'app_origin', cookie: 'absent', originMatchesRequest: true, literalNullOrigin: false }],
    [{ Origin: 'https://app.base44.com', Cookie: ' ' }, { origin: 'platform_origin', cookie: 'empty', originMatchesRequest: false, literalNullOrigin: false }],
    [{ Origin: 'null' }, { origin: 'other', cookie: 'absent', originMatchesRequest: false, literalNullOrigin: true }],
    [{ Origin: 'https://sensitive.example/secret-path', Cookie: 'private=credential' }, { origin: 'other', cookie: 'present', originMatchesRequest: false, literalNullOrigin: false }],
  ]) {
    const denied = await result(fixture, undefined, { headers });
    assert.equal(denied.response.status, 403);
    assert.deepEqual(denied.body, { error: { code: 'forbidden' } });
    assert.deepEqual(fixture.reports.at(-1), { event: 'central_admin_transport_rejected', ...expected });
    assert.equal(Object.isFrozen(fixture.reports.at(-1)), true);
  }
  assert.doesNotMatch(JSON.stringify(fixture.reports), /sensitive|secret|credential|fixture\.header|native-hosted|private=/);
  assert.equal(fixture.hubs.length + fixture.requests.length, 0);
});
test('transport diagnostic categories are deduplicated and capped per function instance', async () => {
  const fixture = makeFixture();
  for (const Origin of [null, '', 'https://caremetricai.base44.app', 'https://app.base44.com', 'https://other.example', 'null']) {
    for (const Cookie of [null, '', 'private=value']) {
      for (let repeat = 0; repeat < 5; repeat += 1) await result(fixture, undefined, { headers: { Origin, Cookie } });
    }
  }
  assert.equal(fixture.reports.length, 10);
  assert.equal(new Set(fixture.reports.map(value => JSON.stringify(value))).size, 10);
});
test('diagnostic sink failures never bypass the browser transport guard', async () => {
  const fixture = makeFixture({ reportTransport: () => { throw new Error('private sink'); } });
  const denied = await result(fixture, undefined, { headers: { Origin: 'null' } });
  assert.equal(denied.response.status, 403);
  assert.deepEqual(denied.body, { error: { code: 'forbidden' } });
  assert.equal(fixture.hubs.length + fixture.requests.length, 0);
});
for (const body of [
  { operation: 'users.delete' }, { operation: 'overview', limit: 20 },
  { operation: 'users.list', limit: 51 }, { operation: 'users.list', limit: '1' },
  { operation: 'users.list', offset: -1 }, { operation: 'users.list', offset: 10001 },
  { operation: 'users.list', search: 'x'.repeat(101) }, { operation: 'users.list', search: '*' },
  { operation: 'users.list', search: 'a\nb' }, { operation: 'users.list', organizationId: AGENCY },
  { operation: 'overview', target: 'https://outside.example' },
]) {
  test(`reject unallowlisted request ${JSON.stringify(body).slice(0, 90)}`, async () => {
    const fixture = makeFixture();
    assert.equal((await result(fixture, body)).response.status, 400);
    assert.equal(fixture.hubs.length + fixture.requests.length, 0);
  });
}
for (const hubStatus of [401, 403, 500]) {
  test(`live Hub denial ${hubStatus} prevents native credential use`, async () => {
    const fixture = makeFixture({ hubStatus });
    assert.equal((await result(fixture)).response.status, hubStatus === 500 ? 503 : hubStatus);
    assert.equal(fixture.requests.length, 0);
  });
}
for (const actor of [
  { user_id: ACTOR, role: 'platform_admin', aal: 'aal1' },
  { user_id: ACTOR, role: 'customer', aal: 'aal2' },
  { user_id: '22222222-2222-4222-8222-222222222222', role: 'platform_admin', aal: 'aal2' },
  { user_id: NATIVE, role: 'platform_admin', aal: 'aal2' },
]) {
  test(`Hub current role/MFA/explicit identity gate ${JSON.stringify(actor)}`, async () => {
    const fixture = makeFixture({ actor });
    assert.equal((await result(fixture)).response.status, 403);
    assert.equal(fixture.requests.length, 0);
  });
}
for (const actors of [
  [], [{ id: NATIVE, role: 'user', account_type: 'super_admin', is_active: true }],
  [{ id: NATIVE, role: 'admin', is_active: false }],
  [{ id: STAFF, role: 'admin' }], [{ id: NATIVE, role: 'admin' }, { id: NATIVE, role: 'admin' }],
]) {
  test(`current native authority is required ${JSON.stringify(actors)}`, async () => {
    const fixture = makeFixture({ read: call => call.fields.includes('is_active') ? actors : undefined });
    assert.equal((await result(fixture)).response.status, 403);
    assert.equal(fixture.calls.length, 1);
  });
}
test('removed mapping and demoted native role take effect on the next request', async () => {
  const fixture = makeFixture();
  assert.equal((await result(fixture, { operation: 'capabilities' })).response.status, 200);
  fixture.data.User[0].role = 'user';
  assert.equal((await result(fixture, { operation: 'capabilities' })).response.status, 403);
  fixture.data.User[0].role = 'admin';
  fixture.env.CAREMETRIC_ADMIN_IDENTITY_MAP_JSON = '{}';
  assert.equal((await result(fixture, { operation: 'capabilities' })).response.status, 503);
});
test('pins Hub issuer and native service destination; never forwards Hub JWT into the native SDK', async () => {
  const fixture = makeFixture();
  const response = await result(fixture, { operation: 'capabilities' }, { headers: {
    'Base44-Api-Url': 'https://outside.example', 'Base44-State': 'attacker-state',
    'Base44-Functions-Version': 'preview', Authorization: 'Bearer unrelated-native-token',
  } });
  assert.equal(response.response.status, 200);
  assert.equal(fixture.hubs[0].url, 'https://xgauehtwksmnoqhgqegm.supabase.co/rest/v1/rpc/authorize_platform_admin');
  assert.equal(fixture.hubs[0].init.redirect, 'error');
  assert.equal(fixture.hubs[0].init.headers.Authorization, TOKEN);
  assert.deepEqual(Object.fromEntries(fixture.requests[0].headers), {
    'base44-app-id': '694ec16e72e01b60d22f7cbf', 'base44-service-authorization': 'Bearer native-hosted-fixture',
  });
  assert.equal(fixture.cleanups(), 1);
  assert.equal(response.response.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(response.response.headers.get('Cache-Control'), /no-store/);
});
for (const headers of [
  { 'Base44-App-Id': '6a9881683dc68a0bd54f1ef7' }, { 'X-Data-Env': 'dev' },
  { 'Base44-Service-Authorization': null },
]) {
  test(`different app/data environment or absent hosted credential ${JSON.stringify(headers)}`, async () => {
    const fixture = makeFixture();
    assert.notEqual((await result(fixture, undefined, { headers })).response.status, 200);
    assert.equal(fixture.requests.length, 0);
  });
}
for (const operation of nativeModule.centralAdminOperations) {
  test(`actual ${operation} producer contains only safe SaaS metadata`, async () => {
    const fixture = makeFixture({ extraFields: true });
    const { response, body } = await result(fixture, { operation });
    assert.equal(response.status, 200);
    assert.equal(body.product, 'pennsync');
    assert.equal(body.operation, operation);
    assert.equal(body.contractVersion, 1);
    assert.doesNotMatch(JSON.stringify(body), /private-|unbound-|favorited_patients|saved_signature|user_email|webhook_events|monthly_amount|agency_code/);
    for (const call of fixture.calls) {
      assert.equal(call.sort, 'id');
      assert.ok(call.limit >= 1 && call.limit <= 500);
      assert.doesNotMatch(call.fields.join(','), /patient|signature|user_email|webhook|amount|agency_code|notes|account_type|staff_role/);
    }
  });
}
test('overview reports registered authority-backed staff, never self-reported active count', async () => {
  const { body } = await result(makeFixture());
  assert.deepEqual(body.data, { organizationCount: 1, activeUserCount: null, registeredUserCount: 2, subscriptionCount: 1 });
});
test('staff directory includes revoked membership history but excludes unbound custom-profile claims', async () => {
  const fixture = makeFixture();
  const { body } = await result(fixture, { operation: 'users.list' });
  assert.deepEqual(body.data.items.map(row => row.id), [NATIVE, STAFF]);
  assert.ok(body.data.items.every(row => row.status === 'registered'));
  const userCalls = fixture.calls.filter(call => call.entity === 'User');
  assert.ok(userCalls.every(call => call.query.role === 'admin' || call.query.id));
});
test('subscriptions are individual cached records with no inferred agency', async () => {
  const { body } = await result(makeFixture(), { operation: 'billing.subscriptions.list' });
  assert.equal(body.data.source, 'application_database');
  assert.equal(body.data.items[0].organizationId, null);
  assert.equal(body.data.items[0].organizationName, null);
  const overview = await result(makeFixture(), { operation: 'billing.overview' });
  assert.deepEqual(overview.body.data.statusCounts, [{ status: 'active', count: 1 }]);
  assert.equal(overview.body.data.subscriptionCount, 1);
});
test('literal search and bounded offsets retain exact filtered totals', async () => {
  const fixture = makeFixture();
  const first = await result(fixture, { operation: 'users.list', search: 'STAFF@', limit: 1, offset: 0 });
  assert.equal(first.body.data.total, 1);
  assert.equal(first.body.data.items[0].id, STAFF);
  const after = await result(fixture, { operation: 'users.list', search: 'staff@', limit: 1, offset: 1 });
  assert.equal(after.body.data.total, 1);
  assert.deepEqual(after.body.data.items, []);
  const literal = await result(fixture, { operation: 'users.list', search: '.', limit: 1, offset: 0 });
  assert.equal(literal.body.data.total, 2);
  const regex = await result(fixture, { operation: 'users.list', search: '[a-z]', limit: 1, offset: 0 });
  assert.equal(regex.body.data.total, 0);
});
test('duplicate, malformed or out-of-scope native rows fail closed', async () => {
  for (const read of [
    call => call.entity === 'Agency' ? [{ id: AGENCY }, { id: AGENCY }] : undefined,
    call => call.entity === 'Agency' ? [{ id: 'invalid' }] : undefined,
    call => call.entity === 'User' && call.query.role ? [{ id: STAFF, role: 'user' }] : undefined,
    call => call.entity === 'AgencyMembership' ? [{ id: '6aa200000000000000000001', user_id: STAFF, agency_id: AGENCY, membership_key: 'wrong' }] : undefined,
  ]) assert.equal((await result(makeFixture({ read }))).response.status, 503);
});
test('a scan above 10000 cannot return a plausible partial total', async () => {
  const fixture = makeFixture({ read: call => call.entity === 'Agency'
    ? Array.from({ length: call.limit }, (_, index) => ({ id: (call.offset + index + 1).toString(16).padStart(24, '0') })) : undefined });
  assert.equal((await result(fixture, { operation: 'organizations.list' })).response.status, 503);
  assert.equal(fixture.calls.filter(call => call.entity === 'Agency').length, 21);
});
test('aborted and failed native reads expose no sensitive error details', async () => {
  const fixture = makeFixture({ read: () => { throw new Error('private-patient Bearer secret'); } });
  const failure = await result(fixture);
  assert.equal(failure.response.status, 503);
  assert.deepEqual(failure.body, { error: { code: 'upstream' } });
  const controller = new AbortController();
  controller.abort();
  assert.notEqual((await result(makeFixture(), undefined, { signal: controller.signal })).response.status, 200);
});

const SMS = `Bearer cmh_${'a'.repeat(43)}`;
test('single-use SMS authorization uses only the fixed PennSync introspection endpoint', async () => {
  let consumed = false;
  const fixture = makeFixture({ fetcher: async (url, init) => {
    assert.equal(url, 'https://support-hub-web-production.up.railway.app/api/internal/admin/pennsync/authorize');
    assert.equal(init.redirect, 'error');
    assert.equal(init.body, '{}');
    assert.deepEqual(init.headers, { Authorization: SMS, 'Content-Type': 'application/json' });
    if (consumed) return Response.json({ error: 'denied' }, { status: 403 });
    consumed = true;
    return Response.json({ user_id: ACTOR, role: 'platform_admin', method: 'sms', operation: { operation: 'users.list', offset: 0, limit: 20 } });
  } });
  const options = { headers: { 'X-CareMetric-Hub-Authorization': SMS } };
  assert.equal((await result(fixture, { operation: 'users.list' }, options)).response.status, 200);
  assert.equal((await result(fixture, { operation: 'users.list' }, options)).response.status, 403);
  assert.equal(fixture.requests.length, 1);
});
for (const change of [
  { operation: { operation: 'overview' } },
  { operation: { operation: 'users.list', limit: 20, offset: 1 } },
  { operation: { operation: 'users.list', limit: 20, offset: 0, search: '' } },
  { operation: { operation: 'users.list', limit: 20, offset: 0, url: 'https://outside.example' } },
  { operation: 'users.list' }, { method: 'email' }, { role: 'customer' }, { extra: true },
]) {
  test(`SMS capability closed response and exact operation binding ${JSON.stringify(change)}`, async () => {
    const fixture = makeFixture({ actor: { user_id: ACTOR, role: 'platform_admin', method: 'sms', operation: { operation: 'users.list', limit: 20, offset: 0 }, ...change } });
    assert.equal((await result(fixture, { operation: 'users.list' }, { headers: { 'X-CareMetric-Hub-Authorization': SMS } })).response.status, 403);
    assert.equal(fixture.requests.length, 0);
  });
}
test('malformed SMS capabilities never fall through to JWT authorization', async () => {
  for (const token of ['Bearer cmh_short', `Bearer cmh_${'a'.repeat(44)}`, 'Bearer cmh_a.b.c']) {
    const fixture = makeFixture();
    assert.equal((await result(fixture, undefined, { headers: { 'X-CareMetric-Hub-Authorization': token } })).response.status, 401);
    assert.equal(fixture.hubs.length, 0);
  }
});
test('SMS still requires current native protected admin authority', async () => {
  const fixture = makeFixture({ actor: { user_id: ACTOR, role: 'platform_admin', method: 'sms', operation: { operation: 'capabilities' } } });
  fixture.data.User[0].role = 'user';
  assert.equal((await result(fixture, { operation: 'capabilities' }, { headers: { 'X-CareMetric-Hub-Authorization': SMS } })).response.status, 403);
});
