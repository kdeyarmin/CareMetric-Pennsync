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
/** The text of every migration the store below was built from, in apply order. */
const applied = [];
/**
 * `create function "public"."pennsync_contract_…"` as the generator and the
 * hand-written contracts both spell it. Quoted, because the first attempt at
 * this matched an unquoted form and found ZERO declarations in a tree that has
 * a hundred and thirty — which is why the set difference below is asserted in
 * BOTH directions: a parser that reads nothing is indistinguishable from a
 * store that exposes nothing unless something else names the functions.
 */
const DECLARATION = /create\s+(?:or\s+replace\s+)?function\s+"?public"?\.\s*"?(pennsync_contract_\w+)"?/gi;

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
      const sql = await readFile(new URL(name, dir), 'utf8');
      applied.push(sql);
      await db.exec(sql);
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

test('no public function this store exposes is reachable anonymously, exempt or not', async () => {
  // **The privilege pair in the test above runs over `captured` — the names the
  // SERVICE calls — and that is not the whole population.** `UNCALLED` exempts a
  // contract from needing a caller, which is what its docblock says it buys. It
  // also, silently, buys exemption from `has_function_privilege('anon', ...)`,
  // because an exempt name is exposed and not captured and so never enters that
  // loop at all. So the one sanctioned way to sit outside the checked population
  // is also the one place a hand-written revoke is load-bearing and unwatched.
  //
  // There is no defect today and this is an unasserted property rather than a
  // fix: `pennsync_contract_activity_list` is revoked correctly in
  // `20260920010000_activity_audit.sql`. The point is that nothing would have
  // noticed if it were not, and the next entry is written by somebody who has
  // not read this comment.
  //
  // It is worth stating why the omission was easy. A wrapper is `security
  // invoker`, so locking the inner `pennsync_records.contract_*` function
  // protects nothing — an anonymous caller reaches the WRAPPER and never the
  // function it would have been refused by. Revoking on the inner function
  // reads like the whole job. That is how the three `physician` wrappers in
  // `20260920690000_contract_physician_write.sql` shipped open, and the loop
  // above caught them only because the service calls them.
  //
  // The population here is every `public.pennsync_contract_*` the store
  // exposes, union the names the service calls — the first covers the exempt,
  // the second covers the authority, audit and broker RPCs, which carry no
  // contract prefix.
  const { rows: exposedRows } = await db.query(`
    select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'pennsync\\_contract\\_%'`);
  const population = [...new Set([...exposedRows.map(row => row.name), ...captured.keys()])].sort();
  assert.ok(population.length > captured.size,
    'this population is no wider than `captured`, so it re-runs the loop above and proves nothing');

  //
  // **Three roles, not two.** The loop above reads `authenticated` and `anon`;
  // the house revoke block names `public, anon, service_role`, and a check that
  // reads two of the three roles a wrapper is granted over reports a clean
  // surface while one stays open. `service_role` is the one that was missing,
  // and it is the one that matters most if it is ever wrong: it is the role a
  // server-side key holds, and a wrapper reachable by it is reachable without
  // a caller identity at all — so every `caller_*` helper under it answers
  // null and the policies have nobody to scope to.
  //
  // Measured before asserting: all of these are already false, so this pins a
  // property that holds rather than announcing a defect. Proved by granting
  // `service_role` on one wrapper and watching it come back by name.
  const { rows } = await db.query(`
    select p.proname as name,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('service_role', p.oid, 'execute') as service_role
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [population]);
  const open = rows.filter(row => row.anon).map(row => row.name).sort();
  assert.deepEqual(open, [],
    'a public function is executable anonymously; revoke on the WRAPPER, not only on the inner contract');
  const serviceRole = rows.filter(row => row.service_role).map(row => row.name).sort();
  assert.deepEqual(serviceRole, [],
    'a public function is executable by the service role, which carries no caller identity');
  const shut = rows.filter(row => !row.authenticated).map(row => row.name).sort();
  assert.deepEqual(shut, [], 'a public function is not executable by a signed-in caller');
});

test('every contract function the migrations expose has a caller, or a stated reason', async () => {
  const { rows } = await db.query(`
    select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'pennsync\\_contract\\_%' order by 1`);
  const exposed = rows.map(row => row.name);

  // This used to open with `exposed.length > 80` under the message "the
  // migrations should expose the contract surface". A magnitude is not that
  // claim: the tree declares a hundred and thirty, so the floor had fifty of
  // slack and no reading of it says which surface is there. What it was
  // actually load-bearing for is the case where the store came up without the
  // contracts at all — then `exposed` is empty, the filter below filters
  // nothing and passes, and the only line left is the loop after it, which
  // runs zero times the moment `UNCALLED` is empty. `UNCALLED` holds ONE
  // entry, so that is one port away: the count and the loop were each strong
  // only while the other's precondition held, and neither states the property.
  //
  // The property is that the store exposes exactly the contract functions the
  // migrations declare, so compare the sets. Each direction means something
  // different and both are checked:
  //   exposed \ declared — the store has a function no file here declares,
  //     which is this harness's parser failing rather than the store drifting.
  //   declared \ exposed — a file declares one the store does not have. Today
  //     that is a defect. A forward migration that permanently DROPS a
  //     contract would land here legitimately, and the remedy then is a named
  //     list with a reason, the shape `UNCALLED` has. There is no such list
  //     now, because pre-allowing a name for a case nobody has is a hint
  //     rather than a control.
  //
  // Both of those sets come from the files this harness read, so a read that
  // returned nothing empties BOTH and they agree with each other. The control
  // is `captured`, which does not: it comes from driving the service's own
  // capabilities, and they name their functions in `services/pennsync-api/`.
  // A harness that built an empty store fails on it, by name.
  const declared = [...new Set([...applied.join('\n').matchAll(DECLARATION)].map(match => match[1]))].sort();
  assert.deepEqual([...captured.keys()].sort().filter(name =>
    name.startsWith('pennsync_contract_') && !declared.includes(name)), [],
  'the service calls a contract function no migration in this tree declares');
  assert.deepEqual(declared.filter(name => !exposed.includes(name)), [],
    'a migration declares a contract function the built store does not expose');
  assert.deepEqual(exposed.filter(name => !declared.includes(name)), [],
    'the store exposes a contract function no migration here declares; this harness reads the declarations wrong');

  assert.deepEqual(exposed.filter(name => !captured.has(name) && !Object.hasOwn(UNCALLED, name)), [],
    'a contract function no capability calls');
  // And the exemption list cannot rot: each entry is still exposed and still uncalled.
  for (const name of Object.keys(UNCALLED)) {
    assert.ok(exposed.includes(name), `${name} is no longer exposed; drop its exemption`);
    assert.equal(captured.has(name), false, `${name} is called now; drop its exemption`);
  }
});
