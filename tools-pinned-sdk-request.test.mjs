import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  stripCommentsAndStrings,
  factoryAliases,
  clientFactoryCalls,
  analyzeFunction,
  scan,
  WRAPPERS,
} from './tools-pinned-sdk-request.mjs';
import { SHARED_HELPERS } from './base44/_shared/backendHelpers.mjs';

// ---------------------------------------------------------------------------
// Runtime behaviour of the primitive the guard above enforces statically.
// The two entry points are evaluated from their SHARED source — the same text
// the sync tool inlines into every function — so these assertions bind the
// behaviour at one place rather than across ~63 handler harnesses. A mutate()
// transform rebuilds the primitive from a sabotaged source so each branch is
// shown to bite before it is believed.
function buildPrimitive(mutate = (s) => s) {
  const source =
    SHARED_HELPERS.pennsyncProductionAppId +
    '\n' +
    mutate(SHARED_HELPERS.base44ClientRequest) +
    '\nreturn { userScopedClientRequest, serviceRoleClientRequest, PENNSYNC_PRODUCTION_APP_ID };';
  return new Function(source)();
}
const PRIM = buildPrimitive();
const APP = PRIM.PENNSYNC_PRODUCTION_APP_ID;
// Build each request against a HOSTILE origin and with the redirect headers set,
// so a pass means the wrapper ignored them, not that they were never there.
const req = (headers) => new Request('https://attacker.example/functions/x', { method: 'POST', headers });

test('PRIMITIVE present-and-matching: SDK request carries the pinned constant and drops the redirect headers', () => {
  const r = PRIM.userScopedClientRequest(
    req({
      'Base44-App-Id': APP,
      Authorization: 'Bearer USER',
      'Base44-Service-Authorization': 'Bearer SVC',
      'X-Data-Env': 'prod',
      'Base44-Api-Url': 'https://evil.example',
      'Base44-State': 'x',
    }),
    APP,
  );
  // Measured, not inferred: the SDK reads appId from THIS header.
  assert.equal(r.headers.get('Base44-App-Id'), APP);
  assert.equal(r.headers.get('Base44-Api-Url'), null, 'the serverUrl redirect header must be dropped');
  assert.equal(r.headers.get('Base44-State'), null);
  assert.equal(r.url, 'https://base44.app/', 'the cosmetic URL is the pinned default origin');
  assert.equal(r.headers.get('Authorization'), 'Bearer USER');
  assert.equal(r.headers.get('X-Data-Env'), 'prod');
  // Load-bearing: the constructed request must NOT be a POST. createClientFromRequest
  // reads only headers.get(...), never the method, so no method is set and the Request
  // defaults to GET. An explicit POST would be inert for the SDK and, once inlined,
  // would read as an outbound delivery primitive to the inventory scanner — this
  // assertion is what keeps the deletion of method:'POST' from silently regressing.
  assert.notEqual(r.method, 'POST', 'the pinned SDK request must not inject a delivery-primitive POST');
  assert.equal(r.method, 'GET', 'absent method defaults the Request to GET');
});

test('PRIMITIVE absent inbound app-id: emits the pinned constant and does NOT throw', () => {
  // This is the FIXTURE and direct-call shape, not a production one: the platform
  // always injects Base44-App-Id, so absent means the request bypassed it. The
  // wrapper falls back to the correct app rather than 500-ing the handler's 403.
  const r = PRIM.userScopedClientRequest(req({ Authorization: 'Bearer USER' }), APP);
  assert.equal(r.headers.get('Base44-App-Id'), APP, 'absent inbound must still hand the SDK the constant');
});

test('PRIMITIVE bare request object with no headers bag (the fixture / direct-call shape): emits the constant, never throws', () => {
  // Contract harnesses invoke handlers with a duck-typed { json } request that has
  // no .headers at all. That carries no inbound app id — the extreme of absent — so
  // it must behave like absent and hand the SDK the pinned constant, not throw on the
  // shape of req. A real Request always has a Headers bag, so this never masks the
  // mismatch refusal on a production request.
  const bare = { json: async () => ({}) };
  const r = PRIM.userScopedClientRequest(bare, APP);
  assert.equal(r.headers.get('Base44-App-Id'), APP);
  assert.equal(PRIM.serviceRoleClientRequest(bare, APP).headers.get('Base44-App-Id'), APP);
});

test('PRIMITIVE present-and-different app-id: refuses, naming both ids', () => {
  assert.throws(
    () => PRIM.userScopedClientRequest(req({ 'Base44-App-Id': 'deadbeefdeadbeefdeadbeef' }), APP),
    (e) => e.message.includes(APP) && e.message.includes('deadbeefdeadbeefdeadbeef'),
  );
});

test('PRIMITIVE posture is chosen by name: serviceRole drops the user token and data-env, userScoped forwards them', () => {
  const headers = {
    'Base44-App-Id': APP,
    Authorization: 'Bearer USER',
    'Base44-Service-Authorization': 'Bearer SVC',
    'X-Data-Env': 'prod',
  };
  const svc = PRIM.serviceRoleClientRequest(req(headers), APP);
  assert.equal(svc.headers.get('Base44-App-Id'), APP);
  assert.equal(svc.headers.get('Base44-Service-Authorization'), 'Bearer SVC');
  assert.equal(svc.headers.get('Authorization'), null, 'service role must not forward the user token');
  assert.equal(svc.headers.get('X-Data-Env'), null, 'service role must not forward data-env');
  const user = PRIM.userScopedClientRequest(req(headers), APP);
  assert.equal(user.headers.get('Authorization'), 'Bearer USER');
});

test('PRIMITIVE X-Data-Env is a closed set: dev/prod honoured, anything else dropped', () => {
  assert.equal(
    PRIM.userScopedClientRequest(req({ 'Base44-App-Id': APP, 'X-Data-Env': 'dev' }), APP).headers.get('X-Data-Env'),
    'dev',
  );
  assert.equal(
    PRIM.userScopedClientRequest(req({ 'Base44-App-Id': APP, 'X-Data-Env': 'staging' }), APP).headers.get('X-Data-Env'),
    null,
    'an out-of-set data-env must be dropped, not forwarded',
  );
});

test('PRIMITIVE requires a non-empty expectedAppId (no default posture)', () => {
  assert.throws(() => PRIM.userScopedClientRequest(req({ 'Base44-App-Id': APP }), ''));
  assert.throws(() => PRIM.userScopedClientRequest(req({ 'Base44-App-Id': APP })));
});

// Sabotage: each mutant breaks exactly one property the tests above assert, and
// must make the matching test fail — a test that does not bite is the thing we
// keep finding.
test('SABOTAGE absent-throws (the Option 1 regression) is caught by the absent-branch test', () => {
  // Restore the strict "received !== expectedAppId" guard that throws on absent.
  const strict = buildPrimitive((s) => s.replace('received !== null && received !== expectedAppId', 'received !== expectedAppId'));
  assert.throws(
    () => strict.userScopedClientRequest(req({ Authorization: 'Bearer USER' }), APP),
    'the absent-branch assertion only holds because the primitive does not throw on absent',
  );
});

test('SABOTAGE dereferencing req.headers directly (the TypeError-on-bare-request regression) is caught', () => {
  // Restore the naive read that assumes req is a real Request; the bare-object test
  // only holds because the primitive reads headers defensively.
  const naive = buildPrimitive((s) =>
    s.replace(
      "const read = (name) => (inbound ? inbound.get(name) : null);",
      "const read = (name) => req.headers.get(name);",
    ),
  );
  assert.throws(() => naive.userScopedClientRequest({ json: async () => ({}) }, APP));
});

test('SABOTAGE forwarding the inbound id instead of SETTING the constant is caught on the absent branch', () => {
  // "Stop forwarding" and "set the pinned value" are different changes; only the
  // second works, because an absent inbound header leaves the SDK with no app id.
  const unset = buildPrimitive((s) => s.replace("headers.set('Base44-App-Id', expectedAppId);", ''));
  const r = unset.userScopedClientRequest(req({ Authorization: 'Bearer USER' }), APP);
  assert.notEqual(r.headers.get('Base44-App-Id'), APP, 'without the set, absent inbound hands the SDK no app id');
});

const HELPER_BLOCK =
  '// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>\n' +
  'function userScopedClientRequest(){}\nfunction serviceRoleClientRequest(){}\n' +
  '// <<<END SHARED HELPER: base44ClientRequest>>>';
const PROD_BLOCK =
  '// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>\n' +
  "const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';\n" +
  '// <<<END SHARED HELPER: pennsyncProductionAppId>>>';

test('stripCommentsAndStrings removes comments, strings and templates', () => {
  const out = stripCommentsAndStrings(
    'a // createClientFromRequest(req)\nb /* x */ c "createClientFromRequest(req)" `t${1}`',
  );
  assert.ok(!out.includes('createClientFromRequest'), 'commented/quoted call must not survive');
  assert.ok(out.includes('a') && out.includes('b') && out.includes('c'));
});

test('stripCommentsAndStrings keeps real code after a regex that contains a quote', () => {
  // This is the exact false-negative class the regex-aware stripper was written
  // to fix: a quote inside a regex must not open string state and swallow the
  // real call after it.
  const src = "const re = /^Bearer [^\\s,]+$/;\nconst ok = /['\"]/.test(x);\nconst b = createClientFromRequest(req);";
  const out = stripCommentsAndStrings(src);
  assert.ok(out.includes('createClientFromRequest(req)'), 'call after a quote-bearing regex must survive');
});

test('stripCommentsAndStrings survives template interpolation with nested code', () => {
  const src = "const u = `${config.serverUrl}/api/apps/${config.appId}/x`;\nconst b = createClientFromRequest(req);";
  const out = stripCommentsAndStrings(src);
  assert.ok(out.includes('createClientFromRequest(req)'));
});

test('factoryAliases detects an identifier bound to createClientFromRequest', () => {
  assert.deepEqual([...factoryAliases('createClient = createClientFromRequest')], ['createClient']);
  assert.deepEqual([...factoryAliases('const other = somethingElse')], []);
});

test('clientFactoryCalls classifies wrapped, raw, aliased and app-id forms', () => {
  const raw = clientFactoryCalls(stripCommentsAndStrings('createClientFromRequest(req)'));
  assert.equal(raw[0].wrapped, false);

  const good = clientFactoryCalls(
    stripCommentsAndStrings('createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID))'),
  );
  assert.equal(good[0].wrapped, true);
  assert.equal(good[0].hasAppId, true);
  assert.equal(good[0].usesProdConst, true);

  const aliased = clientFactoryCalls(
    stripCommentsAndStrings('const createClient = createClientFromRequest;\ncreateClient(serviceRoleClientRequest(request, APP_ID))'),
  );
  assert.ok(aliased.some((c) => c.wrapped && c.wrapper === 'serviceRoleClientRequest' && c.hasAppId && !c.usesProdConst));

  const noAppId = clientFactoryCalls(stripCommentsAndStrings('createClientFromRequest(userScopedClientRequest(req))'));
  assert.equal(noAppId[0].wrapped, true);
  assert.equal(noAppId[0].hasAppId, false);
});

test('analyzeFunction returns null for a function that builds no client', () => {
  assert.equal(analyzeFunction('x', 'export const y = 1;'), null);
});

test('analyzeFunction: a wrapped, app-id-bearing call with both blocks is clean', () => {
  const code = `import x;\n${PROD_BLOCK}\n${HELPER_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));`;
  const a = analyzeFunction('clean', code);
  assert.deepEqual(a.findings, []);
});

// Sabotage: each finding kind must fire when its condition is planted.
test('SABOTAGE raw_call: an unwrapped factory call is flagged', () => {
  const code = `${PROD_BLOCK}\n${HELPER_BLOCK}\nconst b = createClientFromRequest(req);`;
  const a = analyzeFunction('raw', code);
  assert.ok(a.findings.some((f) => f.kind === 'raw_call'), 'raw call must be flagged');
});

test('SABOTAGE missing_app_id: a wrapped call with no expected-app-id is flagged', () => {
  const code = `${PROD_BLOCK}\n${HELPER_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req));`;
  const a = analyzeFunction('noapp', code);
  assert.ok(a.findings.some((f) => f.kind === 'missing_app_id'));
});

test('SABOTAGE helper_missing: a wrapped call without the inlined block is flagged', () => {
  const code = `${PROD_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));`;
  const a = analyzeFunction('nohelper', code);
  assert.ok(a.findings.some((f) => f.kind === 'helper_missing'));
});

test('SABOTAGE prod_const_missing: using the constant without its block is flagged', () => {
  const code = `${HELPER_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));`;
  const a = analyzeFunction('noconst', code);
  assert.ok(a.findings.some((f) => f.kind === 'prod_const_missing'));
});

test('SABOTAGE escape_unexplained: a short ESCAPES reason is flagged, a real one is not', () => {
  const code = `${PROD_BLOCK}\n${HELPER_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));`;
  const short = analyzeFunction('esc', code, { esc: 'too short' });
  assert.ok(short.findings.some((f) => f.kind === 'escape_unexplained'));
  const ok = analyzeFunction('esc', code, { esc: 'a sufficiently detailed reason over twenty characters' });
  assert.ok(!ok.findings.some((f) => f.kind === 'escape_unexplained'));
});

test('scan walks a directory and fails on a planted raw call (bite proof)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pinned-guard-'));
  try {
    const good = path.join(dir, 'goodFn');
    mkdirSync(good);
    writeFileSync(
      path.join(good, 'entry.ts'),
      `${PROD_BLOCK}\n${HELPER_BLOCK}\nconst b = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));`,
    );
    let report = scan(dir);
    assert.equal(report.passed, true, 'a correctly wrapped function must pass');

    const bad = path.join(dir, 'badFn');
    mkdirSync(bad);
    writeFileSync(path.join(bad, 'entry.ts'), 'const b = createClientFromRequest(req);');
    report = scan(dir);
    assert.equal(report.passed, false, 'a raw call must make the scan fail');
    assert.ok(report.findings.some((f) => f.name === 'badFn' && f.kind === 'raw_call'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the live function tree passes the guard', () => {
  const report = scan();
  assert.equal(
    report.passed,
    true,
    `every function must route the SDK factory through ${WRAPPERS.join(' or ')}; findings: ` +
      JSON.stringify(report.findings, null, 2),
  );
  assert.ok(report.functionsUsingFactory > 200, 'sanity: the walk should find the function corpus');
});
