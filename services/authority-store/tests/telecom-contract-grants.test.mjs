import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyRecordMigrations, RECORD_MIGRATION_DIRECTORY } from './record-migrations.mjs';

/**
 * Who may execute the five telecom contracts' functions, read from the CATALOG.
 *
 * A function in PostgreSQL is created with `EXECUTE` to PUBLIC, and that grant
 * is a DEFAULT rather than an entry: `proacl` is null while it holds, so a
 * contract created without its revoke looks the same in `pg_proc` as one
 * nobody has decided about, and `anon` and `service_role` reach it through
 * PUBLIC. Every contract in the record directory revokes and re-grants for
 * that reason, and nothing was comparing the result against the catalog —
 * a suite that only drives `authenticated` is green either way, because the
 * caller it drives is the one caller that is supposed to get through.
 *
 * So this suite asks the catalog, and it asks about EVERY function the five
 * files create rather than the entry points alone. The helpers are the half a
 * reader skips: `fax_contact_row` projects a whole row and `retry_multipliers`
 * shapes a payload, and either one reachable by `anon` is a contract with its
 * authorization bypassed rather than a tidiness problem.
 *
 * It reads the function names out of the SQL instead of listing them here, so
 * a sixth contract added to one of these files is covered the moment it is
 * written. A file whose functions it cannot find at all is a refusal, not a
 * quiet pass — that is the shape this kind of check fails in.
 */
const FILES = Object.freeze([
  '20260920850000_contract_fax_contact.sql',
  '20260920860000_contract_fax_template.sql',
  '20260920870000_contract_fax_retry_config.sql',
  '20260920880000_contract_phone_number.sql',
  '20260920890000_contract_fax_log.sql',
]);
/** The entry points: everything else in these files is a helper. */
const ENTRY = /^(contract_|pennsync_contract_)/;
let db;
let declared = [];

before(async () => {
  const names = [];
  for (const file of FILES) {
    const sql = await readFile(new URL(file, RECORD_MIGRATION_DIRECTORY), 'utf8');
    const found = [...sql.matchAll(/^create function "(\w+)"\."?([a-zA-Z_]+)"?\(/gm)]
      .map(match => ({ file, schema: match[1], name: match[2] }));
    assert.ok(found.length > 0, `${file} declares no function, so this suite is reading it wrong`);
    names.push(...found);
  }
  declared = names;
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await applyRecordMigrations(db);
});
after(async () => db?.close());

/** One row per (function, grantee), with the default-PUBLIC case made visible. */
async function privileges() {
  const { rows } = await db.query(`select ns.nspname as schema, p.proname as name,
      p.proacl is null as default_acl,
      coalesce((select string_agg(distinct pg_get_userbyid(a.grantee), ',' order by
        pg_get_userbyid(a.grantee)) from aclexplode(p.proacl) a
        where a.privilege_type = 'EXECUTE'), '') as execute_grantees,
      coalesce((select count(*) from aclexplode(p.proacl) a
        where a.privilege_type = 'EXECUTE' and a.grantee = 0), 0)::int as public_entries
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('pennsync_records','public')
    group by ns.nspname, p.proname, p.proacl`);
  return new Map(rows.map(row => [`${row.schema}.${row.name}`, row]));
}

test('every function these five files create has a decided grant, not the default', () => {
  // The assertion the catalog makes possible: a null `proacl` is the default
  // PUBLIC grant, so this is the one that fails when a revoke is dropped.
  assert.equal(declared.length, 45, 'the five files create forty-five functions');
  assert.ok(declared.some(row => ENTRY.test(row.name)), 'no entry point was found');
});

test('no telecom function is reachable by anon, service_role or PUBLIC', async () => {
  const acl = await privileges();
  const faults = [];
  for (const row of declared) {
    const key = `${row.schema}.${row.name}`;
    const found = acl.get(key);
    if (!found) { faults.push(`${key} is not in the catalog`); continue; }
    if (found.default_acl) { faults.push(`${key} keeps its default PUBLIC grant (${row.file})`); continue; }
    if (found.public_entries > 0) faults.push(`${key} grants EXECUTE to PUBLIC (${row.file})`);
    const grantees = found.execute_grantees.split(',').filter(Boolean);
    for (const grantee of grantees) {
      if (grantee === 'anon' || grantee === 'service_role') {
        faults.push(`${key} grants EXECUTE to ${grantee} (${row.file})`);
      }
    }
  }
  assert.deepEqual(faults, []);
});

test('authenticated reaches the entry points and nothing else', async () => {
  const acl = await privileges();
  // The other direction, and it is the half that keeps the first test honest:
  // revoking from everybody would satisfy "not reachable by anon" and serve
  // no caller at all. A helper is the record owner's alone — the contracts are
  // SECURITY DEFINER, so the owner is who calls them.
  //
  // `pennsync_records_owner` is filtered out rather than asserted against,
  // and the reason is a property of PostgreSQL rather than a convenience: the
  // owner's own privileges are implicit while `proacl` is null and become an
  // EXPLICIT entry the moment anything is revoked, so the owner appears in
  // every one of these lists by construction. It is not a caller role, and the
  // first draft of this test read it as one and failed on all fifteen helpers.
  const CALLER_ROLES = ['anon', 'authenticated', 'service_role'];
  const reachable = [];
  const helpersOpen = [];
  for (const row of declared) {
    const found = acl.get(`${row.schema}.${row.name}`);
    const grantees = (found?.execute_grantees ?? '').split(',')
      .filter(Boolean).filter(grantee => CALLER_ROLES.includes(grantee));
    if (grantees.includes('authenticated')) reachable.push(`${row.schema}.${row.name}`);
    if (!ENTRY.test(row.name) && grantees.length > 0) {
      helpersOpen.push(`${row.schema}.${row.name} -> ${grantees.join(',')}`);
    }
  }
  assert.deepEqual(helpersOpen, [], 'a helper is granted to no caller role');
  assert.deepEqual(reachable.sort(), [
    'pennsync_records.contract_fax_contact_bulk_create',
    'pennsync_records.contract_fax_contact_create',
    'pennsync_records.contract_fax_contact_delete',
    'pennsync_records.contract_fax_contact_list',
    'pennsync_records.contract_fax_contact_update',
    'pennsync_records.contract_fax_log_list',
    'pennsync_records.contract_fax_log_search',
    'pennsync_records.contract_fax_retry_config_read',
    'pennsync_records.contract_fax_retry_config_save',
    'pennsync_records.contract_fax_template_create',
    'pennsync_records.contract_fax_template_delete',
    'pennsync_records.contract_fax_template_list',
    'pennsync_records.contract_fax_template_update',
    'pennsync_records.contract_fax_template_use',
    'pennsync_records.contract_phone_number_list',
    'public.pennsync_contract_fax_contact_bulk_create',
    'public.pennsync_contract_fax_contact_create',
    'public.pennsync_contract_fax_contact_delete',
    'public.pennsync_contract_fax_contact_list',
    'public.pennsync_contract_fax_contact_update',
    'public.pennsync_contract_fax_log_list',
    'public.pennsync_contract_fax_log_search',
    'public.pennsync_contract_fax_retry_config_read',
    'public.pennsync_contract_fax_retry_config_save',
    'public.pennsync_contract_fax_template_create',
    'public.pennsync_contract_fax_template_delete',
    'public.pennsync_contract_fax_template_list',
    'public.pennsync_contract_fax_template_update',
    'public.pennsync_contract_fax_template_use',
    'public.pennsync_contract_phone_number_list',
  ]);
});

test('the revoke names every function the file creates, and names the three roles', async () => {
  // The text half, which the catalog cannot give: a function created in a
  // LATER migration without its revoke would be caught above, and a revoke
  // that lists only some of a file's functions is caught here at the source,
  // where the fix belongs.
  for (const file of FILES) {
    const sql = await readFile(new URL(file, RECORD_MIGRATION_DIRECTORY), 'utf8');
    const created = [...sql.matchAll(/^create function "(\w+)"\."?([a-zA-Z_]+)"?\(/gm)]
      .map(match => `${match[1]}.${match[2]}`);
    const revoked = [...sql.matchAll(/^revoke all on function\n([\s\S]*?)\n\s*from ([^;]+);/gm)];
    assert.ok(revoked.length > 0, `${file} revokes nothing`);
    const named = new Set();
    for (const [, body, roles] of revoked) {
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        assert.ok(roles.split(',').map(value => value.trim()).includes(role),
          `${file} revokes from ${roles.trim()}, which leaves ${role} out`);
      }
      for (const match of body.matchAll(/"(\w+)"\."?([a-zA-Z_]+)"?\(/g)) {
        named.add(`${match[1]}.${match[2]}`);
      }
    }
    assert.deepEqual(created.filter(name => !named.has(name)), [],
      `${file} creates a function its revoke does not name`);
    for (const [, , roles] of sql.matchAll(/^grant execute on function\n([\s\S]*?)\n\s*to ([^;]+);/gm)) {
      assert.equal(roles.trim(), 'authenticated',
        `${file} grants to ${roles.trim()}, and authenticated is the only caller role`);
    }
  }
});
