import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROKERED_ENTITIES, BROKER_CODES, BROKER_REFUSALS, DEFAULT_PAGE, MAX_PAGE,
  RECORD_OPERATIONS, RECORD_RPC, recordCapability,
} from './records.mjs';
import { AUTHORITY_TARGETS } from './authority.mjs';

/**
 * The service's path to a record.
 *
 * Most of what is under test is what the capability REFUSES. A handler that can
 * reach the store can reach rows belonging to a real agency, so each case below
 * is a denial: an operation nobody defined, an entity outside the family, a
 * write to reference data, an argument nobody declared, and a store failure
 * whose words must not come back through the service.
 *
 * The database is the authority on every one of those answers — `pennsync-
 * staging-authority-store`'s `record-brokers.test.mjs` applies the real
 * migration and proves the policies and the broker deny. Nothing here is a
 * substitute for that. What these cases fix is that the service does not make a
 * request it already knows is wrong, and does not relay what comes back.
 */
const TARGET = AUTHORITY_TARGETS[1];
const KEY = 'sb_publishable_synthetic0000000000';
const BEARER = 'Bearer synthetic.caller.token';
/**
 * The family serves three entities after D22, all read-only. It served 31 until
 * the ceiling was taught to read each schema's own `rls` block, and 28 of those
 * declared an authority decision the family cannot evaluate.
 */
const TENANT = Object.keys(BROKERED_ENTITIES)[0];
const READABLE = Object.keys(BROKERED_ENTITIES);
const config = () => ({ authorityUrl: TARGET, authorityKey: KEY });
const request = (authorization = BEARER) =>
  new Request('https://api.example/v1/functions/probe', { headers: authorization ? { authorization } : {} });
const capability = (overrides = {}, fetcher) => recordCapability({
  config: { ...config(), ...overrides.config },
  req: overrides.req ?? request(),
  agencyId: 'agencyId' in overrides ? overrides.agencyId : 'agency-a',
}, fetcher);
const answers = (value, status = 200) => () => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } });
const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected ${code}`);

test('a read carries the caller own bearer to the fixed RPC for that operation', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = { url, init }; return answers([{ id: 'kb-1' }])(); };
  const rows = await capability({}, fetcher)('list', TENANT, { limit: 10 });
  assert.deepEqual(rows, [{ id: 'kb-1' }]);
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/${RECORD_RPC.list}`);
  assert.equal(seen.init.method, 'POST');
  // The caller's own token authorizes the read; the publishable key names the
  // project and nobody. Reversing those is how a service reads past its caller.
  assert.equal(seen.init.headers.Authorization, BEARER);
  assert.equal(seen.init.headers.apikey, KEY);
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.init.body),
    { p_agency: 'agency-a', p_entity: TENANT, p_limit: 10, p_after: null });
});

test('each operation sends exactly the parameters its broker declares', async () => {
  const sent = {};
  const fetcher = async (url, init) => {
    sent[url.split('/').pop()] = JSON.parse(init.body);
    return answers(url.endsWith('delete') ? true : url.endsWith('list') ? [] : { id: 'row-1' })();
  };
  const records = capability({}, fetcher);
  // Only the reachable operations. The family has no writable entity after
  // D22, so `insert`, `update` and `delete` are refused before a body is built
  // — which the read-only case asserts for every entity rather than this one
  // pretending to exercise a path nothing can take.
  await records('list', TENANT, {});
  await records('get', TENANT, { id: 'row-1' });
  assert.deepEqual(Object.keys(sent).sort(), [RECORD_RPC.get, RECORD_RPC.list].sort());
  assert.equal(sent[RECORD_RPC.list].p_limit, DEFAULT_PAGE, 'the unasked page size is the declared default');
  assert.deepEqual(sent[RECORD_RPC.get], { p_agency: 'agency-a', p_entity: TENANT, p_id: 'row-1' });
  assert.deepEqual(RECORD_OPERATIONS, ['list', 'get', 'insert', 'update', 'delete'],
    'the write operations still exist; nothing may currently reach them');
  // No agency, entity or id reaches the store except as a bound parameter: the
  // RPC name is fixed per operation and nothing a caller sends is concatenated.
  for (const body of Object.values(sent)) assert.ok(body.p_agency === 'agency-a' && body.p_entity === TENANT);
});

test('an entity outside the family never becomes a request', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  for (const entity of ['Patient', 'Visit', 'User', 'ai_knowledge_base', '', 'AIKnowledgeBase; drop', null]) {
    await rejects(capability({}, fetcher)('list', entity, {}), BROKER_CODES.entityNotBrokered);
  }
  for (const operation of ['upsert', 'select', 'truncate', '', 'toString', 'constructor']) {
    await rejects(capability({}, fetcher)(operation, TENANT, {}), 'RECORD_OPERATION_UNKNOWN');
  }
});

test('every entity the family serves is readable and none is writable', async () => {
  assert.ok(READABLE.length > 0, 'the family serves at least one entity');
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  // Refused here as well as in the database, and refused for EVERY entity —
  // the family has nothing writable, which is a property of the ceiling rather
  // than a coincidence of these three.
  for (const entity of READABLE) {
    for (const operation of ['insert', 'update', 'delete']) {
      await rejects(capability({}, fetcher)(operation, entity, { id: 'x', patch: {}, record: {} }),
        BROKER_CODES.entityReadOnly);
    }
  }
  let called = 0;
  const reader = async (url) => { called += 1; return answers(url.endsWith('list') ? [] : { id: 'row-1' })(); };
  for (const entity of READABLE) {
    await capability({}, reader)('list', entity, {});
    await capability({}, reader)('get', entity, { id: 'row-1' });
  }
  assert.equal(called, READABLE.length * 2);
});

test('an argument nobody declared is refused rather than dropped', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  const records = capability({}, fetcher);
  // Dropping one leaves a handler believing it filtered, paged or patched
  // something it did not — the same defect the HTTP edge refuses for params.
  await rejects(records('list', TENANT, { filter: { agency_id: 'agency-b' } }), 'RECORD_ARGUMENTS_INVALID');
  await rejects(records('get', TENANT, { id: 'row-1', agency_id: 'agency-b' }), 'RECORD_ARGUMENTS_INVALID');
  await rejects(records('list', TENANT, null), 'RECORD_ARGUMENTS_REQUIRED');

  await rejects(records('list', TENANT, { limit: MAX_PAGE + 1 }), 'RECORD_LIMIT_INVALID');
  for (const limit of [0, -1, 1.5, '50', Number.NaN]) {
    await rejects(records('list', TENANT, { limit }), 'RECORD_LIMIT_INVALID');
  }
  await rejects(records('list', TENANT, { after: 'not a valid id!' }), 'RECORD_CURSOR_INVALID');
  for (const id of [undefined, null, '', 'has spaces', 42]) {
    await rejects(records('get', TENANT, { id }), 'RECORD_ID_REQUIRED');
  }
  // A write is refused for BEING a write before its arguments are looked at,
  // so the read-only refusal is what a caller sees rather than a shape error.
  await rejects(records('insert', TENANT, { record: 'a string' }), BROKER_CODES.entityReadOnly);
  await rejects(records('update', TENANT, { id: 'row-1', patch: [] }), BROKER_CODES.entityReadOnly);
});

test('a misconfigured or unauthenticated service does not reach the store', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  for (const override of [{ authorityUrl: '' }, { authorityUrl: 'https://elsewhere.example' },
    { authorityKey: '' }, { authorityKey: 'service_role_key' }]) {
    await rejects(capability({ config: override }, fetcher)('list', TENANT, {}), 'AUTHORITY_NOT_CONFIGURED');
  }
  await rejects(capability({ req: request('') }, fetcher)('list', TENANT, {}), 'AUTHENTICATION_REQUIRED');
  await rejects(capability({ req: request('Basic abc') }, fetcher)('list', TENANT, {}), 'AUTHENTICATION_REQUIRED');
  for (const agencyId of ['', null, 'has spaces', 42]) {
    await rejects(capability({ agencyId }, fetcher)('list', TENANT, {}), 'AGENCY_REQUIRED');
  }
});

test('only the family own declared refusals cross back; everything else is one code', async () => {
  for (const code of BROKER_REFUSALS) {
    await rejects(capability({}, answers({ message: code, hint: 'internal', details: 'agency_id' }, 400))
      ('list', TENANT, {}), code);
  }
  // A PostgREST message, a constraint name, a stack — none of it is vocabulary
  // this service speaks, so none of it reaches a caller.
  for (const body of [
    { message: 'permission denied for table ai_knowledge_base' },
    { message: 'relation "pennsync_records.secret" does not exist', hint: 'try pennsync_private' },
    { code: '42501', message: 'PENNSYNC_BROKER_AGENCY_NOT_HELD_EXTRA' },
    { message: null }, 'a bare string', [1, 2, 3], null,
  ]) {
    await rejects(capability({}, answers(body, 400))('list', TENANT, {}), 'RECORD_REFUSED');
  }
  for (const status of [401, 403]) {
    await rejects(capability({}, answers({ message: 'JWT expired' }, status))('list', TENANT, {}),
      'AUTHENTICATION_REJECTED');
  }
});

test('a store that answers the wrong shape is an outage, not a surprise in a handler', async () => {
  for (const [operation, args, body] of [
    ['list', {}, { rows: [] }], ['list', {}, [null]], ['list', {}, ['a string']],

    ['get', { id: 'row-1' }, 'a string'], ['get', { id: 'row-1' }, [1]],
  ]) {
    await rejects(capability({}, answers(body))(operation, TENANT, args), 'RECORD_STORE_UNREADABLE');
  }
  await rejects(capability({}, () => new Response('not json', { status: 200 }))('list', TENANT, {}),
    'RECORD_STORE_UNREADABLE');
  await rejects(capability({}, () => { throw new TypeError('network'); })('list', TENANT, {}),
    'RECORD_STORE_UNREACHABLE');
  // An absent row is an answer, not a failure: `get` says null the same way for
  // "not there" and "not yours", which is what keeps an id in another agency
  // from being reported as existing. `update` and `delete` share that property
  // in the SQL and are not exercised here, because no entity is writable.
  assert.equal(await capability({}, answers(null))('get', TENANT, { id: 'row-1' }), null);
  assert.deepEqual(await capability({}, answers([]))('list', TENANT, {}), []);
});

test('the capability hands out a function, never the token that authorizes it', () => {
  const records = capability({});
  assert.equal(typeof records, 'function');
  // Nothing enumerable, nothing on the function, nothing reachable by property:
  // a handler holds a call, not a credential.
  assert.deepEqual(Object.keys(records), []);
  assert.ok(!JSON.stringify(Object.getOwnPropertyDescriptors(records)).includes('synthetic.caller.token'));
  assert.ok(!String(records).includes(KEY));
});
