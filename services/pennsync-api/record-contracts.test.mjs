import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CONTRACT_CODES, CONTRACT_NAMES, RECORD_CONTRACTS, contractCapability,
} from './record-contracts.mjs';
import { AUTHORITY_TARGETS } from './authority.mjs';
import { MAX_UPSTREAM_BYTES, readJson } from './contracts.mjs';
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

test('every declared contract is reached by a handler, and every reached contract is real', () => {
  // A contract nothing can reach is dead surface; a handler naming a contract
  // that does not exist is a 409 nobody expected.
  //
  // Read from the registry's own source rather than from the handler names,
  // because the two stopped being the same thing: `listAuthorizedPatients` is
  // one Base44 capability with two modes, and the modes are two different
  // queries — a keyset page and a bounded batch of ids — so it reaches two
  // contracts. Matching on names would have forced either one contract doing
  // both jobs or a handler named after neither capability, and both of those
  // are worse than looking at what the handlers actually call.
  // Every module of the service, not only `handlers.mjs`: a capability whose
  // body lives in its own module reaches its contract from there, and
  // `syncCMSRegulations` is the first that does. Scanning one file would have
  // reported it as a contract nothing can reach.
  const directory = new URL('./', import.meta.url);
  const source = readdirSync(directory)
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'))
    .join('\n');
  const reached = [...source.matchAll(/\bcontract\('([A-Za-z]+)'/g)].map(match => match[1]);
  assert.ok(reached.length > 0, 'expected the handlers to reach a contract');
  assert.deepEqual([...new Set(reached)].sort(), [...CONTRACT_NAMES].sort(),
    'every contract is reached, and nothing reaches a contract that does not exist');
  for (const name of CONTRACT_NAMES) {
    const entry = RECORD_CONTRACTS[name];
    assert.match(entry.rpc, /^pennsync_contract_[a-z_]+$/, `${name} rpc name`);
    assert.ok(Array.isArray(entry.params) && typeof entry.body === 'function');
  }
  // And each Base44 capability a contract serves is still a handler by its own
  // name, which is what the port queue counts as ported.
  for (const name of ['listPolicyLibrary', 'listAgencyRoster', 'getAgencyRosterMember',
    'listAuthorizedPatients', 'getAuthorizedPatient']) {
    assert.ok(HANDLER_NAMES.includes(name), `${name} has no handler`);
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
  // Per contract, not per union. Every contract used to be checked against one
  // flat list of every code any of them could raise, which let a contract
  // relay a refusal the contract it called cannot produce — a branch nothing
  // can take that reads like a guarantee somebody wrote. Invisible with one
  // contract; with three it is `listPolicyLibrary` claiming it can answer
  // `PENNSYNC_ROSTER_CURSOR_UNKNOWN`.
  for (const [name, entry] of Object.entries(RECORD_CONTRACTS)) {
    for (const code of entry.codes) {
      await rejects(capability({}, answers({ message: code, hint: 'internal' }, 400))(name, {}), code);
    }
    for (const foreign of CONTRACT_CODES.filter(code => !entry.codes.includes(code))) {
      await rejects(capability({}, answers({ message: foreign }, 400))(name, {}), 'CONTRACT_REFUSED');
    }
  }
  assert.ok(CONTRACT_CODES.length > RECORD_CONTRACTS.listPolicyLibrary.codes.length,
    'the union must be wider than one contract, or the case above proves nothing');
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

test('the roster sends what its contract declares and refuses what it does not', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = { url, init }; return answers({ entries: [], next: null })(); };
  assert.deepEqual(await capability({}, fetcher)('listAgencyRoster', {}), { entries: [], next: null });
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/pennsync_contract_roster_list`);
  // Absent means absent, not zero: the contract's own defaults decide the page
  // size, so a service that sent one would be a second answer to keep in step.
  assert.deepEqual(JSON.parse(seen.init.body), { p_agency: 'agency-a', p_limit: null, p_after: null });
  await capability({}, fetcher)('listAgencyRoster', { limit: 50, after: 'a'.repeat(24) });
  assert.deepEqual(JSON.parse(seen.init.body),
    { p_agency: 'agency-a', p_limit: 50, p_after: 'a'.repeat(24) });

  await capability({}, fetcher)('getAgencyRosterMember', { user_id: 'b'.repeat(24) });
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/pennsync_contract_roster_get`);
  assert.deepEqual(JSON.parse(seen.init.body), { p_agency: 'agency-a', p_user_id: 'b'.repeat(24) });

  // An argument nobody declared is refused rather than dropped: dropping one
  // leaves a handler believing it paged or filtered something it did not.
  const reject = async () => { throw new Error('the store must not have been called'); };
  await rejects(capability({}, reject)('listAgencyRoster', { agency_id: 'agency-b' }), 'CONTRACT_ARGUMENTS_INVALID');
  await rejects(capability({}, reject)('getAgencyRosterMember', { email: 'x@y' }), 'CONTRACT_ARGUMENTS_INVALID');
});

test('an absent roster member is an answer, and only where a contract says so', async () => {
  // `null` from `getAgencyRosterMember` is how "not there" and "not a
  // colleague of yours" are made indistinguishable, so a caller cannot learn
  // that an id belongs to somebody in an agency they cannot see. The same
  // `null` from a contract that returns an object is the store answering
  // something nobody can use.
  assert.equal(await capability({}, answers(null))('getAgencyRosterMember', { user_id: 'c'.repeat(24) }), null);
  await rejects(capability({}, answers(null))('listAgencyRoster', {}), 'RECORD_STORE_UNREADABLE');
  await rejects(capability({}, answers(null))('listPolicyLibrary', {}), 'RECORD_STORE_UNREADABLE');
});

test('a store that answers the wrong shape is an outage, not a surprise in a handler', async () => {
  for (const body of ['a string', [1, 2], 5, null]) {
    await rejects(capability({}, answers(body))('listPolicyLibrary', {}), 'RECORD_STORE_UNREADABLE');
  }
  await rejects(capability({}, () => new Response('not json', { status: 200 }))('listPolicyLibrary', {}),
    'RECORD_STORE_UNREADABLE');
  // A declared length is NOT the limit, and must not be: an upstream can lie
  // about it, and the previous version of this checked the header and then
  // called `response.json()` — which reads the whole body however large. The
  // bytes actually read are the limit now, so a small body with an absurd
  // header succeeds and an oversized stream is refused.
  assert.deepEqual(await capability({}, () => new Response(JSON.stringify({ policies: [] }), {
    status: 200, headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 * 1024) },
  }))('listPolicyLibrary', {}), { policies: [] });
  await rejects(capability({}, () => { throw new TypeError('network'); })('listPolicyLibrary', {}),
    'RECORD_STORE_UNREACHABLE');
});

test('the bounded reader stops a stream rather than reading whatever arrives', async () => {
  // Driven with an explicit small maximum so the property is provable without
  // generating 16MiB. `MAX_UPSTREAM_BYTES` is the production value and is
  // asserted to be finite and sane rather than exercised at full size.
  assert.ok(Number.isSafeInteger(MAX_UPSTREAM_BYTES) && MAX_UPSTREAM_BYTES > 0);
  const chunked = (total, chunk = 1024) => new Response(new ReadableStream({
    pull(controller) {
      const size = Math.min(chunk, total);
      total -= size;
      if (size === 0) { controller.close(); return; }
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  }), { headers: { 'content-type': 'application/json' } });

  // No Content-Length at all, so the header check the old code relied on would
  // have let this through untouched.
  await assert.rejects(readJson(chunked(64 * 1024), 8 * 1024),
    error => error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE');
  // And a body inside the cap still parses.
  assert.deepEqual(await readJson(
    new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }), 8 * 1024), { ok: true });
});

test('the capability hands out a function, never the token that authorizes it', () => {
  const contract = capability({});
  assert.equal(typeof contract, 'function');
  assert.deepEqual(Object.keys(contract), []);
  assert.ok(!JSON.stringify(Object.getOwnPropertyDescriptors(contract)).includes('synthetic.caller.token'));
  assert.ok(!String(contract).includes(KEY));
});
