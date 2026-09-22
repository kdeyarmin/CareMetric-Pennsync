import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { AUTHORITY_RPC, resolveAuthority } from '../../pennsync-api/authority.mjs';
import { AUDIT_RPC, auditCapability } from '../../pennsync-api/audit.mjs';
import { RECORD_RPC, recordCapability } from '../../pennsync-api/records.mjs';
import { BROKERED_ENTITIES, READ_ONLY_MODES } from '../../pennsync-api/brokered-entities.mjs';
import { RECORD_CONTRACTS, contractCapability } from '../../pennsync-api/record-contracts.mjs';

/**
 * Every call the ported service makes resolves against the migrations it will
 * be deployed beside — by NAME, which is how PostgREST resolves it.
 *
 * `/rest/v1/rpc/<name>` with a JSON body is matched to a function by the
 * function's name AND the names of the body's keys: an unknown key, or a
 * parameter with no default that the body omits, is a 404 from the gateway
 * rather than an answer. Every suite in `services/pennsync-api` stubs the
 * network, and every contract suite here calls its function positionally in
 * SQL, so a parameter renamed on one side and not the other passed everything
 * and would have surfaced first in Stage D, as a release that refuses every
 * request.
 *
 * So the request bodies are not restated here. They are CAPTURED, by driving
 * each of the service's own capabilities — authority, audit, records and the
 * eighty contracts — through its real code path with a fetcher that records
 * what would have gone over the wire, and then compared with `pg_proc` in a
 * database built from every migration in the order a deployment applies them.
 * Measured against hosted staging on 2026-09-22 the same way: all 87 present,
 * callable by `authenticated`, closed to `anon`, and every key a parameter.
 */
const TARGET = 'http://127.0.0.1:54321';
const KEY = 'sb_publishable_service-rpc-signature-check';
const config = Object.freeze({ authorityUrl: TARGET, authorityKey: KEY, appId: '6a9881683dc68a0bd54f1ef7' });
const req = { headers: new Headers({ authorization: `Bearer ${'a'.repeat(40)}` }) };
const AGENCY = 'agency-a';

/**
 * A `pennsync_contract_*` function the service does not call, with the reason.
 * A contract with no caller is dead SQL — the same rule the purpose policies
 * follow — so a new one has to be wired or named here.
 */
const UNCALLED = Object.freeze({
  pennsync_contract_activity_list: 'D25\'s read of the trail. Its codes are declared as AUDIT_LIST_CODES '
    + 'and it waits on an administrative capability that reads the trail; none is ported',
});

let db;
const captured = new Map();

/** Records the one request a capability makes, then answers nothing usable. */
const recorder = (label) => async (url, init) => {
  const name = new URL(url).pathname.replace(/^\/rest\/v1\/rpc\//, '');
  assert.ok(!captured.has(name) || captured.get(name).label === label, `${name} is reached by two capabilities`);
  captured.set(name, { label, keys: Object.keys(JSON.parse(init.body)).sort() });
  return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
};
const settle = async (promise) => { try { await promise; } catch { /* the capture is the point */ } };

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  // The order a deployment applies them: every authority migration, then every
  // record migration, each directory by name.
  for (const directory of ['../supabase/migrations/', '../supabase/record-migrations/']) {
    const dir = new URL(directory, import.meta.url);
    for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, dir), 'utf8'));
    }
  }

  await settle(resolveAuthority(config, req, AGENCY, recorder('authority')));
  const bound = { config, req, agencyId: AGENCY };
  await settle(auditCapability(bound, recorder('audit'))('signature_check'));
  const records = recordCapability(bound, recorder('records'));
  const brokered = Object.keys(BROKERED_ENTITIES).sort()[0];
  await settle(records('list', brokered, {}));
  await settle(records('get', brokered, { id: 'row-1' }));
  const contract = contractCapability(bound, recorder('contracts'));
  for (const name of Object.keys(RECORD_CONTRACTS)) await settle(contract(name, {}));
});
after(async () => db?.close());

test('every capability the service holds was driven, so nothing below is vacuous', () => {
  const byLabel = label => [...captured.values()].filter(entry => entry.label === label).length;
  assert.equal(byLabel('authority'), 1);
  assert.equal(byLabel('audit'), 1);
  assert.equal(byLabel('records'), 2);
  // Eighty contracts, eighty distinct functions: no two share an RPC.
  assert.equal(byLabel('contracts'), Object.keys(RECORD_CONTRACTS).length);
  assert.equal(new Set(Object.values(RECORD_CONTRACTS).map(entry => entry.rpc)).size,
    Object.keys(RECORD_CONTRACTS).length);
  assert.ok(captured.has(AUTHORITY_RPC) && captured.has(AUDIT_RPC));
});

test('the broker family\'s write RPCs are unreachable from the service, and that is checked rather than assumed', () => {
  // All three brokered entities are read-only under D2's ceiling as D22
  // re-checks it, so `records` refuses insert, update and delete before any
  // request is built, and there is no body to capture. When an entity becomes
  // writable this fails, and the three write bodies have to be captured too.
  for (const [entity, mode] of Object.entries(BROKERED_ENTITIES)) {
    assert.ok(READ_ONLY_MODES.includes(mode), `${entity} is writable; capture the broker's write bodies`);
  }
  for (const operation of ['insert', 'update', 'delete']) {
    assert.equal(captured.has(RECORD_RPC[operation]), false);
  }
});

test('every call the service makes resolves by name against the migrations', async () => {
  const names = [...captured.keys()].sort();
  const { rows } = await db.query(`
    select p.proname as name, p.pronargdefaults as defaults,
      array(select a.name from unnest(p.proargnames) with ordinality as a(name, ord)
        where p.proargmodes is null or p.proargmodes[a.ord] in ('i', 'b', 'v') order by a.ord) as args,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [names]);
  const signatures = new Map();
  for (const row of rows) {
    signatures.set(row.name, { ...row, overloads: (signatures.get(row.name)?.overloads ?? 0) + 1 });
  }
  assert.deepEqual(names.filter(name => !signatures.has(name)), [], 'the service calls a function no migration defines');
  for (const name of names) {
    const { keys, label } = captured.get(name);
    const signature = signatures.get(name);
    const where = `${label}: ${name}`;
    // One function per name, or PostgREST picks by the key set and a body that
    // fits two of them is an ambiguity error.
    assert.equal(signature.overloads, 1, `${where} is overloaded`);
    assert.deepEqual(keys.filter(key => !signature.args.includes(key)), [], `${where} is sent keys it has no parameter for`);
    const required = signature.args.slice(0, signature.args.length - signature.defaults);
    assert.deepEqual(required.filter(arg => !keys.includes(arg)), [], `${where} is not sent a parameter it requires`);
    assert.equal(signature.authenticated, true, `${where} is not executable by a signed-in caller`);
    assert.equal(signature.anon, false, `${where} is executable anonymously`);
  }
});

test('every contract function the migrations expose has a caller, or a stated reason', async () => {
  const { rows } = await db.query(`
    select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'pennsync\\_contract\\_%' order by 1`);
  const exposed = rows.map(row => row.name);
  assert.ok(exposed.length > 80, 'the migrations should expose the contract surface');
  assert.deepEqual(exposed.filter(name => !captured.has(name) && !Object.hasOwn(UNCALLED, name)), [],
    'a contract function no capability calls');
  // And the exemption list cannot rot: each entry is still exposed and still uncalled.
  for (const name of Object.keys(UNCALLED)) {
    assert.ok(exposed.includes(name), `${name} is no longer exposed; drop its exemption`);
    assert.equal(captured.has(name), false, `${name} is called now; drop its exemption`);
  }
});
