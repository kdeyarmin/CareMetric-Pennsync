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
  [{ headers: { Cookie: 'session=anything', 'X-CareMetric-Hub-Authorization': null } }, 401],
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
    [{ Origin: 'https://caremetricai.base44.app', Cookie: 'sensitive-session=secret' }, { origin: 'app_origin', cookie: 'present', originMatchesRequest: true, literalNullOrigin: false }],
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
    'Base44-Functions-Version': 'preview', Authorization: 'Bearer unrelated-native-token', Cookie: 'hosted-session=private',
  } });
  assert.equal(response.response.status, 200);
  assert.equal(fixture.hubs[0].url, 'https://xgauehtwksmnoqhgqegm.supabase.co/rest/v1/rpc/authorize_platform_admin');
  assert.equal(fixture.hubs[0].init.redirect, 'manual');
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
    assert.equal(init.redirect, 'manual');
    assert.equal(init.body, '{}');
    assert.deepEqual(init.headers, { Authorization: SMS, 'Content-Type': 'application/json' });
    if (consumed) return Response.json({ error: 'denied' }, { status: 403 });
    consumed = true;
    return Response.json({ user_id: ACTOR, role: 'platform_admin', method: 'sms', operation: { operation: 'users.list', offset: 0, limit: 20 } });
  } });
  const options = { headers: { 'X-CareMetric-Hub-Authorization': SMS, Cookie: 'hosted-session=private' } };
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
    assert.equal((await result(fixture, { operation: 'users.list' }, { headers: { 'X-CareMetric-Hub-Authorization': SMS, Cookie: 'hosted-session=private' } })).response.status, 403);
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

test('hosted cookies never substitute for the mandatory Hub header or authorize simple browser requests', async () => {
  for (const Cookie of [null, '', 'hosted-session=private']) {
    for (const token of [null, 'Bearer notjwt', 'Bearer cmh_short']) {
      const fixture = makeFixture();
      const denied = await result(fixture, { operation: 'capabilities' }, { headers: {
        Cookie, 'X-CareMetric-Hub-Authorization': token, Authorization: TOKEN,
      } });
      assert.equal(denied.response.status, 401);
      assert.deepEqual(denied.body, { error: { code: 'unauthenticated' } });
      assert.equal(fixture.hubs.length + fixture.requests.length, 0);
    }
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=fixture']) {
      const fixture = makeFixture();
      const denied = await result(fixture, undefined, { headers: { Cookie, 'Content-Type': contentType } });
      assert.equal(denied.response.status, 415);
      assert.equal(fixture.hubs.length + fixture.requests.length, 0);
    }
  }
});

test('browser origins remain forbidden with cookies and even a structurally valid Hub capability', async () => {
  for (const Origin of ['null', 'https://caremetricai.base44.app', 'https://app.base44.com', 'https://outside.example']) {
    for (const token of [null, TOKEN, SMS]) {
      const fixture = makeFixture();
      const denied = await result(fixture, { operation: 'capabilities' }, { headers: {
        Origin, Cookie: 'hosted-session=private', 'X-CareMetric-Hub-Authorization': token,
      } });
      assert.equal(denied.response.status, 403);
      assert.equal(denied.response.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(fixture.hubs.length + fixture.requests.length, 0);
    }
  }
});

test('cookie-bearing requests still recheck Hub authority and current native protected role on every call', async () => {
  for (const token of [TOKEN, SMS]) {
    const actor = token === SMS
      ? { user_id: ACTOR, role: 'platform_admin', method: 'sms', operation: { operation: 'capabilities' } }
      : { user_id: ACTOR, role: 'platform_admin', aal: 'aal2' };
    let hubStatus = 200;
    const fixture = makeFixture({ fetcher: async () => Response.json(actor, { status: hubStatus }) });
    const options = { headers: { Cookie: 'hosted-session=private', 'X-CareMetric-Hub-Authorization': token } };
    assert.equal((await result(fixture, { operation: 'capabilities' }, options)).response.status, 200);
    assert.equal(fixture.hubs.length, 1);
    assert.equal(fixture.requests[0].headers.get('Cookie'), null);
    assert.equal(new Headers(fixture.hubs[0].init.headers).get('Cookie'), null);
    fixture.data.User[0].role = 'user';
    assert.equal((await result(fixture, { operation: 'capabilities' }, options)).response.status, 403);
    fixture.data.User[0].role = 'admin';
    fixture.data.User[0].is_active = false;
    assert.equal((await result(fixture, { operation: 'capabilities' }, options)).response.status, 403);
    fixture.data.User[0].is_active = true;
    hubStatus = 403;
    const nativeRequests = fixture.requests.length;
    assert.equal((await result(fixture, { operation: 'capabilities' }, options)).response.status, 403);
    assert.equal(fixture.requests.length, nativeRequests);
    assert.equal(fixture.hubs.length, 4);
  }
});

test('failure diagnostics distinguish Hub transport, identity and native stages without exposing errors', async () => {
  const privateError = Object.assign(new Error('private-patient Bearer credential user@example.test'), { response: { status: 502, data: 'private-body' } });
  const cases = [
    [{ fetcher: async () => { throw privateError; } }, {}, 'hub_authorization', null, null],
    [{ hubStatus: 503 }, {}, 'hub_authorization', 503, null],
    [{ actor: { role: 'customer' } }, {}, 'hub_identity', 200, null],
    [{}, { headers: { 'Base44-Service-Authorization': null } }, 'native_transport', 200, 503],
    [{ createClient: () => { throw privateError; } }, {}, 'native_factory', 200, 502],
    [{ read: () => { throw privateError; } }, {}, 'native_identity', 200, 502],
    [{ read: call => { if (call.entity === 'Agency') throw privateError; } }, {}, 'native_read', 200, 502],
  ];
  for (const [options, request, stage, hubStatus, nativeStatus] of cases) {
    const fixture = makeFixture(options);
    const failed = await result(fixture, { operation: 'overview' }, request);
    assert.ok(failed.response.status >= 400);
    assert.equal(fixture.failures.length, 1);
    const event = fixture.failures[0];
    assert.deepEqual(Object.keys(event).sort(), ['event', 'stage', 'status', 'hubStatus', 'nativeStatus', 'nativeApp', 'dataEnvironment', 'serviceCredential', 'failureKind', 'requestAborted'].sort());
    assert.equal(event.event, 'central_admin_request_failed');
    assert.equal(event.stage, stage);
    assert.equal(event.hubStatus, hubStatus);
    assert.equal(event.nativeStatus, nativeStatus);
    assert.equal(event.nativeApp, 'expected');
    assert.equal(event.dataEnvironment, 'absent');
    assert.equal(event.serviceCredential, stage === 'native_transport' ? 'absent' : 'bearer');
    assert.ok(Object.isFrozen(event));
    assert.doesNotMatch(JSON.stringify(event), /private|Bearer credential|example\.test|native-hosted-fixture|11111111|694ec16e72/i);
  }
});

test('native header diagnostics report closed categories only', async () => {
  for (const [headers, expected] of [
    [{ 'Base44-App-Id': null }, { nativeApp: 'absent', dataEnvironment: 'absent', serviceCredential: 'bearer' }],
    [{ 'Base44-App-Id': 'private-app' }, { nativeApp: 'other', dataEnvironment: 'absent', serviceCredential: 'bearer' }],
    [{ 'X-Data-Env': ' private-environment ' }, { nativeApp: 'expected', dataEnvironment: 'other', serviceCredential: 'bearer' }],
    [{ 'X-Data-Env': '', 'Base44-Service-Authorization': '' }, { nativeApp: 'expected', dataEnvironment: 'empty', serviceCredential: 'empty' }],
    [{ 'X-Data-Env': 'prod', 'Base44-Service-Authorization': 'private-invalid' }, { nativeApp: 'expected', dataEnvironment: 'prod', serviceCredential: 'other' }],
  ]) {
    const fixture = makeFixture();
    await result(fixture, { operation: 'capabilities' }, { headers });
    assert.equal(fixture.failures.length, 1);
    for (const [key, value] of Object.entries(expected)) assert.equal(fixture.failures[0][key], value);
    assert.doesNotMatch(JSON.stringify(fixture.failures), /private-/);
  }
});

test('diagnostics cannot change denied responses when status getters or sinks throw', async () => {
  const hostile = new Error('private-details');
  Object.defineProperty(hostile, 'status', { get() { throw new Error('private-getter'); } });
  const fixture = makeFixture({ read: () => { throw hostile; } });
  assert.equal((await result(fixture)).response.status, 503);
  assert.equal(fixture.failures[0].nativeStatus, null);
  const brokenSink = makeFixture({ read: () => { throw hostile; }, reportFailure: () => { throw new Error('private-sink'); } });
  assert.deepEqual((await result(brokenSink)).body, { error: { code: 'upstream' } });
});

test('failure diagnostics are deduplicated and capped per handler, while every request remains denied', async () => {
  let status = 500;
  const fixture = makeFixture({ read: () => { throw { status }; } });
  for (let index = 0; index < 3; index++) assert.equal((await result(fixture)).response.status, 503);
  assert.equal(fixture.failures.length, 1);
  for (status = 500; status < 530; status++) assert.equal((await result(fixture)).response.status, 503);
  assert.equal(fixture.failures.length, 20);
});

test('successful requests and routine anonymous input do not emit failure diagnostics', async () => {
  const fixture = makeFixture();
  assert.equal((await result(fixture, { operation: 'capabilities' })).response.status, 200);
  assert.equal((await result(fixture, undefined, { headers: { 'X-CareMetric-Hub-Authorization': null } })).response.status, 401);
  assert.equal((await result(fixture, undefined, { headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
  assert.equal((await result(fixture, { operation: 'unsupported' })).response.status, 400);
  assert.deepEqual(fixture.failures, []);
});

test('hosted fetch failure classification emits only known condition enums, never exception values', async () => {
  for (const [error, expected] of [
    [new DOMException('private details', 'TimeoutError'), 'timeout'],
    [new DOMException('private details', 'AbortError'), 'aborted'],
    [Object.assign(new TypeError('private details'), { cause: { code: 'ENOTFOUND' } }), 'dns'],
    [new Error('certificate invalid private-host'), 'tls'],
    [new Error('redirect to private-host'), 'redirect'],
    [new Error('permission denied private-host'), 'permission'],
    [new Error('connection refused private-host'), 'connection'],
    [new TypeError('Illegal invocation private details'), 'invalid_fetch_receiver'],
    [new TypeError('AbortSignal invalid private details'), 'signal_option'],
    [new Error('unsupported private option'), 'unsupported'],
    [new TypeError('private details'), 'type_error'],
    [new Error('private details'), 'other'],
  ]) {
    const fixture = makeFixture({ fetcher: () => { throw error; } });
    const response = await result(fixture);
    assert.equal(response.response.status, 503);
    assert.equal(fixture.failures[0].failureKind, expected);
    assert.equal(fixture.failures[0].requestAborted, false);
    assert.doesNotMatch(JSON.stringify(fixture.failures), /private|ENOTFOUND|details|invocation/);
  }
  const hostile = new Error('private details');
  Object.defineProperty(hostile, 'message', { get() { throw new Error('private getter'); } });
  const fixture = makeFixture({ fetcher: () => { throw hostile; } });
  assert.equal((await result(fixture)).response.status, 503);
  assert.equal(fixture.failures[0].failureKind, 'other');
});

test('manual Hub fetch never follows redirects or trusts their authorization-shaped bodies', async () => {
  for (const token of [TOKEN, SMS]) {
    for (const status of [301, 302, 303, 304, 307, 308]) {
      const fixture = makeFixture({ fetcher: async (url, init) => {
        assert.equal(init.redirect, 'manual');
        assert.equal(url, token === SMS
          ? 'https://support-hub-web-production.up.railway.app/api/internal/admin/pennsync/authorize'
          : 'https://xgauehtwksmnoqhgqegm.supabase.co/rest/v1/rpc/authorize_platform_admin');
        return new Response(status === 304 ? null : JSON.stringify({ user_id: ACTOR, role: 'platform_admin', aal: 'aal2', method: 'sms', operation: { operation: 'capabilities' } }),
          { status, headers: { Location: 'https://outside.example/private-destination' } });
      } });
      const rejected = await result(fixture, { operation: 'capabilities' }, { headers: { 'X-CareMetric-Hub-Authorization': token } });
      assert.equal(rejected.response.status, 503);
      assert.equal(fixture.hubs.length, 1);
      assert.equal(fixture.requests.length, 0);
      assert.doesNotMatch(JSON.stringify(rejected.body), /outside|destination|11111111/);
    }
  }
});

test('an unexpectedly followed Hub response cannot authorize native access', async () => {
  const fixture = makeFixture({ fetcher: async () => {
    const response = Response.json({ user_id: ACTOR, role: 'platform_admin', aal: 'aal2' });
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  } });
  assert.equal((await result(fixture)).response.status, 503);
  assert.equal(fixture.requests.length, 0);
});
