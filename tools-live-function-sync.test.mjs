import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUSION_REASONS, PRODUCTION_APP, PUBLISHED_ORIGIN, classifyComparability,
  compareObserved, functionUrl, main, parseArguments, planComparison, validateApp, verifyFunctions,
} from './tools-live-function-sync.mjs';
import { RETIRED_APP } from './tools-pennsync-provision.mjs';

// A sweep row shaped like `auditAnonymousSource` returns. `refusing` is the
// shape the tool may compare: a refusal reached without the environment, the
// SDK, the auth stub, or the request method.
const row = (name, overrides = {}) => ({
  name, status: 503, responseCode: 'paused_code', authChecks: 0,
  operations: [], environmentKeys: [], ...overrides,
});
const sweeps = (...rows) => ({
  post: rows.map(([r]) => r), get: rows.map(([, g]) => g),
});
const pair = (name, overrides = {}) => [row(name, overrides), row(name, overrides)];

test('a refusal reached without environment, SDK, auth or method is comparable', () => {
  assert.deepEqual(classifyComparability(row('a'), row('a')), { comparable: true, reason: null });
});

test('each exclusion is named by the reason that makes the harness answer, not the source', () => {
  const cases = [
    ['NOT_EXECUTED', { status: null }],
    ['ENVIRONMENT_DEPENDENT', { environmentKeys: ['OUTBOUND_FAX_WORKFLOW_RELEASE'] }],
    ['HARNESS_BLOCKED', { operations: ['entities.IntegrationSecret.filter'] }],
    ['HARNESS_AUTH_STUB', { authChecks: 1 }],
    ['NOT_A_REFUSAL', { status: 200, responseCode: null }],
  ];
  for (const [reason, overrides] of cases) {
    assert.deepEqual(classifyComparability(row('a', overrides), row('a', overrides)),
      { comparable: false, reason }, reason);
    assert.equal(typeof EXCLUSION_REASONS[reason], 'string');
  }
  assert.deepEqual(
    classifyComparability(row('a'), row('a', { status: 405 })),
    { comparable: false, reason: 'METHOD_DEPENDENT' },
  );
});

test('an absent GET counterpart is not executed rather than silently comparable', () => {
  assert.deepEqual(classifyComparability(row('a'), undefined), { comparable: false, reason: 'NOT_EXECUTED' });
  assert.deepEqual(planComparison([row('a')], []).comparable, []);
});

test('the plan splits every swept function into exactly one side', () => {
  const { post, get } = sweeps(
    pair('zComparable'),
    pair('aEnvGated', { environmentKeys: ['X'] }),
    pair('mAuthGated', { authChecks: 1 }),
  );
  const plan = planComparison(post, get);
  assert.deepEqual(plan.comparable.map(r => r.name), ['zComparable']);
  assert.deepEqual(plan.excluded.map(r => r.name), ['aEnvGated', 'mAuthGated']);
  assert.equal(plan.comparable.length + plan.excluded.length, post.length);
  for (const entry of plan.excluded) assert.equal(entry.detail, EXCLUSION_REASONS[entry.reason]);
});

test('a status match with a different refusal code is drift, because the code names which gate answered', () => {
  const expected = { name: 'a', status: 503, code: 'telehealth_provider_migration_pending' };
  assert.equal(compareObserved(expected, { status: 503, code: 'telehealth_provider_migration_pending' }).verdict, 'matched');
  assert.equal(compareObserved(expected, { status: 503, code: 'something_else' }).verdict, 'drifted');
  assert.equal(compareObserved(expected, { status: 401, code: null }).verdict, 'drifted');
  assert.equal(compareObserved(expected, { status: 404, code: null }).verdict, 'not_deployed');
  assert.equal(compareObserved(expected, { error: 'REQUEST_TIMEOUT' }).verdict, 'unreachable');
  // No expected code means the status alone decides, so a deployment that adds
  // a code is not drift.
  assert.equal(compareObserved({ name: 'a', status: 401, code: null }, { status: 401, code: 'anything' }).verdict, 'matched');
});

test('an unreachable probe never surfaces the thrown value', async () => {
  const report = await verifyFunctions(PUBLISHED_ORIGIN, PRODUCTION_APP, [{ name: 'a', status: 503, code: null }], {
    fetchImpl: () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 proxy=http://secret@host'); },
  });
  assert.equal(report.results[0].verdict, 'unreachable');
  assert.equal(report.results[0].detail, 'REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(report), /ECONNREFUSED|secret|10\.0\.0\.1/);
});

test('only a known, non-retired app may be checked', () => {
  assert.equal(validateApp(PRODUCTION_APP), PRODUCTION_APP);
  assert.throws(() => validateApp(RETIRED_APP), /APP_RETIRED/);
  assert.throws(() => validateApp('6a9881683dc68a0bd54f1ef8'), /APP_UNKNOWN/);
});

test('a function name may not shape the probe path', () => {
  assert.equal(functionUrl(PUBLISHED_ORIGIN, PRODUCTION_APP, 'sendMessage'),
    `${PUBLISHED_ORIGIN}/api/apps/${PRODUCTION_APP}/functions/sendMessage`);
  for (const name of ['../../entities/Patient', 'a/b', 'a?x=1', 'a#b', '', 'a b', '_a']) {
    assert.throws(() => functionUrl(PUBLISHED_ORIGIN, PRODUCTION_APP, name), /FUNCTION_NAME_INVALID/, name);
  }
});

test('arguments are exact', () => {
  assert.deepEqual(parseArguments([]), { origin: PUBLISHED_ORIGIN, app: PRODUCTION_APP, only: null, json: false });
  assert.deepEqual(parseArguments(['--only', 'a,b']).only, ['a', 'b']);
  assert.throws(() => parseArguments(['--nope']), /INVALID_ARGUMENTS/);
  assert.throws(() => parseArguments(['--origin']), /INVALID_ARGUMENTS/);
});

const auditStub = (rows) => async (_root, _payload, { method } = {}) => ({
  discoveryErrors: [],
  results: rows.map(entry => (method === 'GET' ? entry.get : entry.post)),
});
const capture = () => { const lines = []; return { log: line => lines.push(line), lines }; };

test('a deployment answering as the tree says passes', async () => {
  const { log, lines } = capture();
  const code = await main([], {
    audit: auditStub([{ post: row('a'), get: row('a') }]),
    fetchImpl: async () => new Response(JSON.stringify({ code: 'paused_code' }), { status: 503 }),
    log,
  });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /^OK production/);
});

test('a deployment serving replaced code is drift, and names both sides', async () => {
  const { log, lines } = capture();
  const code = await main(['--json'], {
    audit: auditStub([{ post: row('listMyMessages'), get: row('listMyMessages') }]),
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    log,
  });
  assert.equal(code, 1);
  const report = JSON.parse(lines.join('\n'));
  assert.equal(report.passed, false);
  assert.equal(report.byVerdict.drifted, 1);
  assert.deepEqual(report.results[0].expected, { status: 503, code: 'paused_code' });
  assert.deepEqual(report.results[0].observed, { status: 401, code: null });
});

// The control for every exclusion. Each planted row WOULD be reported as drift
// if it were compared - the live answer differs in all three - so a quiet run
// is the exclusion working. Assert the absence AND the reason, because a run
// that compared nothing at all would also report no drift.
test('a non-comparable function is never reported as drift, and says why', async () => {
  for (const [reason, overrides] of [
    ['ENVIRONMENT_DEPENDENT', { environmentKeys: ['FAX_POLL_RELEASE'] }],
    ['HARNESS_BLOCKED', { operations: ['entities.IntegrationSecret.filter'] }],
    ['HARNESS_AUTH_STUB', { authChecks: 1 }],
  ]) {
    const { log, lines } = capture();
    const code = await main(['--json'], {
      audit: auditStub([
        { post: row('comparableOne'), get: row('comparableOne') },
        { post: row('excludedOne', overrides), get: row('excludedOne', overrides) },
      ]),
      fetchImpl: async (url) => (url.endsWith('comparableOne')
        ? new Response(JSON.stringify({ code: 'paused_code' }), { status: 503 })
        : new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
      log,
    });
    const report = JSON.parse(lines.join('\n'));
    assert.equal(code, 0, reason);
    assert.equal(report.byVerdict.drifted, 0, reason);
    assert.equal(report.checked, 1, reason);
    assert.equal(report.excludedByReason[reason], 1, reason);
    assert.ok(!report.results.some(entry => entry.name === 'excludedOne'), reason);
  }
});

test('a method-dependent refusal is excluded although both sweeps executed', async () => {
  const { log, lines } = capture();
  const code = await main(['--json'], {
    audit: auditStub([{ post: row('saveOasisResponses'), get: row('saveOasisResponses', { status: 405, responseCode: null }) }]),
    fetchImpl: async () => new Response('{}', { status: 405 }),
    log,
  });
  assert.equal(code, 2, 'nothing comparable is not a pass');
  const report = JSON.parse(lines.join('\n'));
  assert.equal(report.checked, 0);
  assert.deepEqual(report.errors, [{ code: 'NOTHING_COMPARABLE' }]);
  assert.equal(report.excludedByReason.METHOD_DEPENDENT, 1);
});

test('a sweep that could not ask is not a sweep that found nothing', async () => {
  const { log, lines } = capture();
  const code = await main(['--json'], {
    audit: auditStub([{ post: row('a'), get: row('a') }]),
    fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
    log,
  });
  assert.equal(code, 2, 'could not verify is not drift');
  const report = JSON.parse(lines.join('\n'));
  assert.equal(report.passed, false);
  assert.deepEqual(report.errors, [{ code: 'DEPLOYMENT_UNREACHABLE' }]);
  assert.equal(report.byVerdict.unreachable, 1);
  assert.equal(report.results[0].detail, 'REQUEST_TIMEOUT');
});

test('an incomplete source sweep refuses instead of reporting a clean deployment', async () => {
  const { log, lines } = capture();
  const code = await main(['--json'], {
    audit: async () => ({ discoveryErrors: [{ code: 'FUNCTION_ENTRY_UNREADABLE' }], results: [row('a')] }),
    fetchImpl: async () => { throw new Error('must not be reached'); },
    log,
  });
  assert.equal(code, 2);
  assert.match(lines.join('\n'), /SOURCE_SWEEP_INCOMPLETE/);
});

test('an unverifiable target refuses rather than falling back to production', async () => {
  for (const args of [['--origin', 'https://evilcaremetricai.com'], ['--origin', 'http://caremetricai.base44.app'],
    ['--app', RETIRED_APP], ['--app', 'not-an-app']]) {
    const { log, lines } = capture();
    const code = await main(args, {
      audit: async () => { throw new Error('must not sweep before the target is valid'); },
      fetchImpl: async () => { throw new Error('must not probe'); },
      log,
    });
    assert.equal(code, 2, args.join(' '));
    assert.match(lines.join('\n'), /INVALID_ORIGIN|APP_RETIRED|APP_UNKNOWN/, args.join(' '));
  }
});

test('--only refuses a name that is unknown or not comparable, rather than checking nothing', async () => {
  const rows = [{ post: row('a'), get: row('a') }, { post: row('b', { authChecks: 1 }), get: row('b', { authChecks: 1 }) }];
  for (const [args, expected] of [[['--only', 'nope'], /UNKNOWN_FUNCTION/], [['--only', 'b'], /FUNCTION_NOT_COMPARABLE/]]) {
    const { log, lines } = capture();
    assert.equal(await main([...args, '--json'], { audit: auditStub(rows), fetchImpl: async () => new Response('{}'), log }), 2);
    assert.match(lines.join('\n'), expected);
  }
});
