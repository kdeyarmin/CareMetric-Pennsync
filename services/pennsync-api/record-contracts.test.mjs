import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_CODES, CONTRACT_NAMES, RECORD_CONTRACTS, contractCapability,
} from './record-contracts.mjs';
import { AUTHORITY_TARGETS } from './authority.mjs';
import { HANDLER_NAMES } from './handlers.mjs';

/**
 * The service's path to a reviewed per-capability contract.
 *
 * The contract itself is what authorizes — `contract-policy-library.test.mjs`
 * applies the real migration and proves its denials against a real database.
 * Nothing here is a substitute for that, and this module deliberately carries
 * no authorization logic to test: a copy would be a second answer to keep in
 * agreement with the first.
 *
 * What these cases fix is that the service sends exactly what the contract
 * declares, refuses what it already knows is wrong, and relays nothing the
 * store said beyond the contract's own vocabulary.
 */
const TARGET = AUTHORITY_TARGETS[1];
const KEY = 'sb_publishable_synthetic0000000000';
const BEARER = 'Bearer synthetic.caller.token';
const config = () => ({ authorityUrl: TARGET, authorityKey: KEY });
const request = (authorization = BEARER) =>
  new Request('https://api.example/v1/functions/probe', { headers: authorization ? { authorization } : {} });
const capability = (overrides = {}, fetcher) => contractCapability({
  config: { ...config(), ...overrides.config },
  req: overrides.req ?? request(),
  agencyId: 'agencyId' in overrides ? overrides.agencyId : 'agency-a',
}, fetcher);
const answers = (value, status = 200) => () => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } });
const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected ${code}`);

test('every declared contract has a handler, and every handler name is real', () => {
  // A contract nothing can reach is dead surface; a handler naming a contract
  // that does not exist is a 409 nobody expected.
  for (const name of CONTRACT_NAMES) {
    assert.ok(HANDLER_NAMES.includes(name), `${name} has no handler`);
    const entry = RECORD_CONTRACTS[name];
    assert.match(entry.rpc, /^pennsync_contract_[a-z_]+$/, `${name} rpc name`);
    assert.ok(Array.isArray(entry.params) && typeof entry.body === 'function');
  }
});

test('a call sends the declared parameters to the fixed RPC with the caller own bearer', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = { url, init }; return answers({ policies: [] })(); };
  assert.deepEqual(await capability({}, fetcher)('listPolicyLibrary', { mode: 'all' }), { policies: [] });
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/pennsync_contract_policy_library_list`);
  assert.equal(seen.init.headers.Authorization, BEARER, 'the caller own authority, never the service own');
  assert.equal(seen.init.headers.apikey, KEY);
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.init.body), { p_agency: 'agency-a', p_mode: 'all' });
});

test('an absent mode defaults and an explicit null does not', async () => {
  // The original defaults an ABSENT mode to 'active' and answers 400 for an
  // explicit null. Defaulting null too would quietly accept a caller's bug.
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return answers({ policies: [] })(); };
  const contract = capability({}, fetcher);
  await contract('listPolicyLibrary', {});
  await contract('listPolicyLibrary', { mode: null });
  assert.deepEqual(sent.map(body => body.p_mode), ['active', null]);
});

test('a contract nobody declared, or an argument nobody declared, never becomes a request', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  const contract = capability({}, fetcher);
  for (const name of ['getDashboardData', 'listPolicyLibrary ', '', 'toString', null, 42]) {
    await rejects(contract(name, {}), 'CONTRACT_UNKNOWN');
  }
  // Dropping an unknown argument leaves a caller believing it filtered
  // something it did not.
  for (const args of [{ mode: 'all', agency_id: 'agency-b' }, { status: 'draft' }, { limit: 10 }]) {
    await rejects(contract('listPolicyLibrary', args), 'CONTRACT_ARGUMENTS_INVALID');
  }
  for (const args of [null, 'a string', []]) {
    await rejects(contract('listPolicyLibrary', args), 'CONTRACT_ARGUMENTS_REQUIRED');
  }
});

test('a misconfigured or unauthenticated service does not reach the store', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  for (const override of [{ authorityUrl: '' }, { authorityUrl: 'https://elsewhere.example' },
    { authorityKey: '' }, { authorityKey: 'service_role_key' }]) {
    await rejects(capability({ config: override }, fetcher)('listPolicyLibrary', {}), 'AUTHORITY_NOT_CONFIGURED');
  }
  await rejects(capability({ req: request('') }, fetcher)('listPolicyLibrary', {}), 'AUTHENTICATION_REQUIRED');
  for (const agencyId of ['', null, 'has spaces', 42]) {
    await rejects(capability({ agencyId }, fetcher)('listPolicyLibrary', {}), 'AGENCY_REQUIRED');
  }
});

test('only the contract own declared refusals cross back; everything else is one code', async () => {
  for (const code of CONTRACT_CODES) {
    await rejects(capability({}, answers({ message: code, hint: 'internal' }, 400))
      ('listPolicyLibrary', {}), code);
  }
  // A contract raises 42501 for a forbidden mode, which PostgREST reports as
  // 403 — that is the contract speaking, not the gateway rejecting the token,
  // and the two must not be conflated.
  await rejects(capability({}, answers({ message: 'PENNSYNC_CONTRACT_FORBIDDEN' }, 403))
    ('listPolicyLibrary', { mode: 'all' }), 'PENNSYNC_CONTRACT_FORBIDDEN');
  await rejects(capability({}, answers({ message: 'JWT expired' }, 401))('listPolicyLibrary', {}),
    'AUTHENTICATION_REJECTED');
  for (const body of [{ message: 'permission denied for table policy_library' },
    { message: 'PENNSYNC_CONTRACT_FORBIDDEN_EXTRA' }, { message: null }, 'a bare string', [1], null]) {
    await rejects(capability({}, answers(body, 400))('listPolicyLibrary', {}), 'CONTRACT_REFUSED');
  }
});

test('a store that answers the wrong shape is an outage, not a surprise in a handler', async () => {
  for (const body of ['a string', [1, 2], 5, null]) {
    await rejects(capability({}, answers(body))('listPolicyLibrary', {}), 'RECORD_STORE_UNREADABLE');
  }
  await rejects(capability({}, () => new Response('not json', { status: 200 }))('listPolicyLibrary', {}),
    'RECORD_STORE_UNREADABLE');
  await rejects(capability({}, () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) },
  }))('listPolicyLibrary', {}), 'RECORD_STORE_UNREADABLE');
  await rejects(capability({}, () => { throw new TypeError('network'); })('listPolicyLibrary', {}),
    'RECORD_STORE_UNREACHABLE');
});

test('the capability hands out a function, never the token that authorizes it', () => {
  const contract = capability({});
  assert.equal(typeof contract, 'function');
  assert.deepEqual(Object.keys(contract), []);
  assert.ok(!JSON.stringify(Object.getOwnPropertyDescriptors(contract)).includes('synthetic.caller.token'));
  assert.ok(!String(contract).includes(KEY));
});
