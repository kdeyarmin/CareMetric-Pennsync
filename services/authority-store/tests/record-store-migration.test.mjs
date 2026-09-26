import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { OWNER_ROLE, RECORD_MIGRATION_FILE, SCHEMA, renderMigration } from '../../../tools-entity-schema-plan.mjs';

/**
 * The record store as a deployment actually gets it.
 *
 * `record-tenant-isolation.test.mjs` proves what each table's predicate means,
 * applying the generated DDL directly and granting itself the access it needs.
 * That leaves the two questions this file answers, both of which decide whether
 * those predicates are worth anything in a real database:
 *
 * 1. **Who owns the tables.** `force row level security` binds a table's owner
 *    — but never a `SUPERUSER` or `BYPASSRLS` role. The authority store's
 *    migrations require exactly such an administrator, so tables left owned by
 *    the migration role would carry 596 policies that nothing obeys. Both
 *    reviewers of the policy work raised this, and it was recorded as open
 *    because the migration that creates the store did not exist. It does now.
 *
 * 2. **How a caller reaches a row.** RLS policy expressions are evaluated with
 *    the privileges of the role running the query, so granting a caller direct
 *    table access also means granting it `execute` on the caller helpers — the
 *    functions that answer "who is asking", which the generated DDL revokes
 *    precisely so the asker cannot call them. The migration therefore grants no
 *    caller role anything, and the surface is a broker owned by the record
 *    owner. The test below builds such a broker and shows the composition
 *    holds: inside it the policies bind, the helpers are reachable, and the
 *    `role` setting still reads `authenticated` so the caller gate recognises
 *    the session.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENCY_A = 1; const AGENCY_B = 4;
const CALLER_ROLES = ['anon', 'authenticated', 'service_role'];
/**
 * The caller helpers, read from the database rather than listed here.
 *
 * It WAS listed here, and that is how `caller_roster_ids()` — added with D23's
 * roster policy — was left out of the owner's grant while the policy that asks
 * it shipped. A hand-kept list of what to check cannot catch the thing it was
 * not told about, so the list is now whatever the schema holds.
 */
let HELPERS = [];
let TRIGGER_FUNCTIONS = [];
const signature = entry => (typeof entry === 'string' ? `${entry}()` : `${entry.name}(${entry.args})`);
const helperName = entry => (typeof entry === 'string' ? entry : entry.name);
let db;

/**
 * Every authority migration in order. The record store is deliberately not in
 * that directory, so this builds exactly the database it is applied on top of.
 */
async function authority(target) {
  await target.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await target.exec(await readFile(new URL(name, dir), 'utf8'));
  }
}
/** The record store migration, named rather than discovered. */
const recordStore = () => readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');

before(async () => {
  db = new PGlite();
  await authority(db);
  await db.exec(recordStore());
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // A broker, owned by the record owner. This is the shape the plan calls for
  // rather than a production API: what is under test is that a function owned
  // by a non-bypass role can serve a caller who holds nothing at all.
  await db.exec(`
    set local role ${OWNER_ROLE};
    create function ${SCHEMA}.broker_supply() returns table(id text)
      language sql volatile security definer set search_path = '' as $$
      select "id" from ${SCHEMA}.supply_item $$;
    create function ${SCHEMA}.broker_add(p_id text, p_agency text) returns text
      language sql volatile security definer set search_path = '' as $$
      insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name")
      values ('${APP}', p_id, p_agency, 'Brokered') returning "id" $$;
    create function ${SCHEMA}.broker_session() returns table(who text, role_setting text)
      language sql stable security definer set search_path = '' as $$
      select current_user::text, current_setting('role', true) $$;
    reset role;
    grant usage on schema ${SCHEMA} to authenticated;
    grant execute on function ${SCHEMA}.broker_supply(), ${SCHEMA}.broker_session(),
      ${SCHEMA}.broker_add(text, text) to authenticated;`);
  await db.exec(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','supply-a','agency-a','Gauze A'), ('${APP}','supply-b','agency-b','Gauze B');`);
  // Whatever the migration actually created, minus this file's own brokers.
  // Both spellings are taken from the catalog, because the two questions below
  // need different ones: it matches a bare `proname`, while
  // `has_function_privilege` needs the argument list.
  // `oidvectortypes` rather than `pg_get_function_identity_arguments`, which
  // includes parameter NAMES in this server; `has_function_privilege` wants
  // types alone. `proargtypes` also leaves out OUT parameters, so a
  // `returns table(...)` helper reports the signature callers actually use.
  //
  // Split by what the function IS, not by its name. A caller helper answers
  // "who is asking" out of `pennsync_private`, which is why it must stay
  // administrator-owned and out of every caller's reach. A trigger function
  // answers nothing — D82's profile guard compares `old` to `new` and returns —
  // so it is created with its table, by the table's owner, and only the
  // reachability half of the rule applies to it. Asking the catalog for the
  // return type keeps that distinction from resting on a naming convention.
  const { rows: helpers } = await db.query(`
    select p.proname as name, pg_catalog.oidvectortypes(p.proargtypes) as args,
           p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $1 and p.proname not like 'broker\\_%'`, [SCHEMA]);
  HELPERS = helpers.filter(row => !row.is_trigger);
  TRIGGER_FUNCTIONS = helpers.filter(row => row.is_trigger);
  assert.ok(HELPERS.length >= 8, `expected the helper set to be substantial, found ${HELPERS.length}`);
});
after(async () => db?.close());

/** Speak as one of the fixture identities, holding only what the migration grants. */
async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}

test('the committed migration is exactly what the generator produces', async () => {
  const committed = recordStore();
  assert.equal(committed, renderMigration(repository).sql,
    'The record store migration has drifted from the generator. '
    + 'Re-run `node tools-entity-schema-plan.mjs --write-migration` rather than editing the SQL.');
});

test('the import tool inbound-key guard still matches the schema it guards', () => {
  // `tools-pennsync-archive-import.mjs` names the inbound foreign keys to
  // `pennsync_private.patient` EXACTLY and refuses the whole import if the set
  // differs, because those RESTRICT keys are what make rolling back an
  // imported patient refuse while something clinical still references it.
  //
  // That coupling is invisible from either side. Its own suite proves it, but
  // that suite needs a real PostgreSQL, is gated behind `PENNSYNC_TEST_PG_URL`
  // and is NOT part of `pnpm test` — so a change dropping one of those keys
  // passes the whole default run and fails only in CI. It did: D24's first
  // attempt dropped `assignment`'s patient key to let an assignment name a
  // patient of record, and every one of the sixteen import cases refused with
  // `IMPORT_SCHEMA_UNSAFE`.
  //
  // This is the same assertion, read from both files rather than from a
  // database, so it runs everywhere `pnpm test` does.
  const tool = readFileSync(resolve(repository, 'tools-pennsync-archive-import.mjs'), 'utf8');
  const expected = tool.match(/same\(dependencies\.map\(d => d\.name\), \[([^\]]*)\]/);
  assert.ok(expected, 'the import tool must still pin its inbound keys by name');
  const guarded = [...expected[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]).sort();

  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, migrations), 'utf8')).join('\n');
  // Every table declaring a foreign key into `patient`, taken from the SQL the
  // deployment actually applies.
  const declared = new Set();
  for (const match of sql.matchAll(/create table pennsync_private\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/g)) {
    if (/references pennsync_private\.patient\s*\(/.test(match[2])) declared.add(match[1]);
  }
  for (const match of sql.matchAll(/alter table pennsync_private\.([a-z0-9_]+)[^;]*?references pennsync_private\.patient\s*\(/g)) {
    declared.add(match[1]);
  }
  for (const match of sql.matchAll(/alter table pennsync_private\.([a-z0-9_]+)\s+drop constraint[^;]*patient_id_fkey/g)) {
    declared.delete(match[1]);
  }
  assert.deepEqual([...declared].sort(), guarded,
    'a table gained or lost a foreign key into patient; the archive import guard must be updated with it');
  // And the one D24 nearly removed is named, so its absence is loud.
  assert.ok(guarded.includes('assignment'),
    'assignment keys to patient on purpose: it is what refuses a rollback that would orphan a care team');
});

test('the record owner is a role row level security applies to', async () => {
  const { rows } = await db.query(
    'select rolsuper, rolbypassrls, rolcanlogin from pg_catalog.pg_roles where rolname = $1', [OWNER_ROLE]);
  assert.equal(rows.length, 1, `${OWNER_ROLE} should exist after the migration`);
  // Any one of these being true silently voids all 596 policies.
  assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false, rolcanlogin: false });
});

test('the tables belong to that role and the caller helpers deliberately do not', async () => {
  const { rows: tables } = await db.query(`
    select count(*)::integer as total,
           count(*) filter (where r.rolname = $2)::integer as owned
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where n.nspname = $1 and c.relkind = 'r'`, [SCHEMA, OWNER_ROLE]);
  assert.ok(tables[0].total > 100, 'expected the carried set to be substantial');
  assert.equal(tables[0].owned, tables[0].total, 'every record table must be owned by the non-bypass role');

  // The helpers read `pennsync_private`, whose tables force RLS with no
  // allowing policy. Owned by the record owner they would return nothing, and
  // every policy that asks them would deny every row.
  const { rows: helpers } = await db.query(`
    select p.proname, r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = $1 and p.proname = any($2)`, [SCHEMA, HELPERS.map(helperName)]);
  assert.equal(helpers.length, HELPERS.length);
  assert.deepEqual(helpers.filter(row => row.rolname === OWNER_ROLE), [],
    'the caller helpers must stay administrator-owned');
});

test('no caller role is granted anything: not a table, not a helper', async () => {
  const { rows: onTables } = await db.query(`
    select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = $1 and grantee = any($2)`, [SCHEMA, CALLER_ROLES]);
  assert.deepEqual(onTables, [], 'the migration must grant no caller role access to a record table');

  // `has_function_privilege` is asked rather than the catalog, because a grant
  // to PUBLIC would not appear as a row against these names but would still let
  // a caller ask the store who it is.
  for (const role of CALLER_ROLES) {
    for (const helper of HELPERS) {
      const { rows } = await db.query('select has_function_privilege($1, $2, \'execute\') as allowed',
        [role, `${SCHEMA}.${signature(helper)}`]);
      assert.equal(rows[0].allowed, false, `${role} must not be able to execute ${signature(helper)}`);
    }
  }
  // A trigger function is owned by its table rather than by the administrator,
  // but the reachability rule is the same one: `create function` grants execute
  // to PUBLIC, so a guard nobody revoked is a function every caller role can
  // call by name.
  for (const role of CALLER_ROLES) {
    for (const guard of TRIGGER_FUNCTIONS) {
      const { rows } = await db.query('select has_function_privilege($1, $2, \'execute\') as allowed',
        [role, `${SCHEMA}.${signature(guard)}`]);
      assert.equal(rows[0].allowed, false, `${role} must not be able to execute ${signature(guard)}`);
    }
  }
  // The owner may, and must: the policies ask these helpers while the broker runs.
  for (const helper of HELPERS) {
    const { rows } = await db.query('select has_function_privilege($1, $2, \'execute\') as allowed',
      [OWNER_ROLE, `${SCHEMA}.${signature(helper)}`]);
    assert.equal(rows[0].allowed, true, `${OWNER_ROLE} must be able to execute ${signature(helper)}`);
  }
});

test('every helper a policy asks is one the owner may call, because a policy runs as the querying role', () => {
  // The failure this catches is silent and total: a policy expression is
  // evaluated with the privileges of the role running the query, and inside a
  // broker that role is the record owner. A helper a policy asks and the
  // owner's grant omits does not deny a row — it denies the whole read with
  // `permission denied for function`.
  //
  // It happened. D23's `user_read` asks `caller_roster_ids()`, which was added
  // to the helpers and left out of the grant, and every check here was over a
  // hand-kept list that had never heard of it. So this reads BOTH sides out of
  // the migration: which helpers the policies call, and which the grant names.
  const sql = recordStore();
  const asked = new Set();
  for (const match of sql.matchAll(/create policy "[a-z0-9_]+" on [^;]+;/g)) {
    for (const [, helper] of match[0].matchAll(/"pennsync_records"\.([a-z_]+)\s*\(/g)) asked.add(helper);
  }
  assert.ok(asked.size >= 3, `expected the policies to ask several helpers, found ${[...asked]}`);
  assert.ok(asked.has('caller_roster_ids'), 'the roster policy asks it, which is how this gap was found');
  const grant = sql.match(/grant execute on function ([^;]+) to "pennsync_records_owner";/);
  assert.ok(grant, 'the migration must grant the helpers to the owner');
  const granted = new Set([...grant[1].matchAll(/"pennsync_records"\.([a-z_]+)\s*\(/g)].map(match => match[1]));
  assert.deepEqual([...asked].filter(helper => !granted.has(helper)).sort(), [],
    'a policy asks a helper the owner cannot execute, which denies the read outright');
});

test('the roster policy really is reachable through a broker, not only in principle', async () => {
  // The test above reads the grant; this spends it. `user` is the one table
  // whose policy asks a helper nothing else asks, so it is the one where a
  // missing grant shows up as an outage rather than as an empty result — and
  // an empty result is what a test that only counted rows would have accepted.
  await db.exec(`insert into ${SCHEMA}."user"("source_app_id","id","agency_id") values
    ('${APP}','6aac00000000000000000001','agency-b'), ('${APP}','6aac00000000000000000004','agency-a');`);
  await db.exec(`
    set local role ${OWNER_ROLE};
    create function ${SCHEMA}.broker_roster() returns table(id text)
      language sql stable security definer set search_path = '' as $$
      select "id" from ${SCHEMA}."user" $$;
    reset role;
    grant execute on function ${SCHEMA}.broker_roster() to authenticated;`);
  try {
    // Seeded with each row claiming the OTHER agency, so a policy reading the
    // row's own label would answer these two exactly the wrong way round.
    assert.deepEqual(await as(AGENCY_A, `select * from ${SCHEMA}.broker_roster()`),
      [{ id: '6aac00000000000000000001' }]);
    assert.deepEqual(await as(AGENCY_B, `select * from ${SCHEMA}.broker_roster()`),
      [{ id: '6aac00000000000000000004' }]);
  } finally {
    await db.exec(`drop function ${SCHEMA}.broker_roster(); delete from ${SCHEMA}."user";`);
  }
});

test('D82: a person may correct their own profile, and the store refuses every other write', async () => {
  // D23 left this open on purpose and D82 closes it at the narrowest shape that
  // works. The shape is two mechanisms, because one cannot express it: the
  // policy says WHOSE row, the trigger says WHICH COLUMNS, and a test that
  // exercised only the policy would pass while a clinician rewrote their own
  // `role` to `admin`.
  //
  // Seeded, again, with each row claiming the OTHER agency, so nothing here can
  // be passing because a predicate read the label the subject controls.
  await db.exec(`insert into ${SCHEMA}."user"("source_app_id","id","agency_id","phone","role") values
    ('${APP}','6aac00000000000000000001','agency-b','111','user'),
    ('${APP}','6aac00000000000000000004','agency-a','444','user');`);
  await db.exec(`
    set local role ${OWNER_ROLE};
    create function ${SCHEMA}.broker_profile_set(p_id text, p_column text, p_value text)
      returns table(id text, phone text, role text)
      language plpgsql volatile security definer set search_path = '' as $broker$
      begin
        -- %L rather than a bound parameter: the columns under test are not all
        -- text, and an untyped literal is coerced to whichever type the column
        -- has, so one broker can try role, is_approved and offboarded_at.
        return query execute format(
          'update %I.%I set %I = %L where "id" = $1 returning "id", "phone", "role"',
          $$${SCHEMA}$$, 'user', p_column, p_value) using p_id;
      end $broker$;
    create function ${SCHEMA}.broker_profile_delete(p_id text) returns table(id text)
      language sql volatile security definer set search_path = '' as $$
      delete from ${SCHEMA}."user" where "id" = p_id returning "id" $$;
    create function ${SCHEMA}.broker_profile_get(p_id text, p_column text)
      returns text language plpgsql stable security definer set search_path = '' as $get$
      declare v_value text;
      begin
        execute format('select %I::text from %I.%I where "id" = $1',
          p_column, $$${SCHEMA}$$, 'user') into v_value using p_id;
        return v_value;
      end $get$;
    reset role;
    grant execute on function ${SCHEMA}.broker_profile_set(text, text, text),
      ${SCHEMA}.broker_profile_get(text, text),
      ${SCHEMA}.broker_profile_delete(text) to authenticated;`);
  const set = (who, id, column, value) =>
    as(who, `select * from ${SCHEMA}.broker_profile_set($1, $2, $3)`, [id, column, value]);
  try {
    // Their own row, an allowlisted column: the one thing D82 permits.
    assert.deepEqual(await set(AGENCY_A, '6aac00000000000000000001', 'phone', '222'),
      [{ id: '6aac00000000000000000001', phone: '222', role: 'user' }]);

    // Somebody else's row. Not an error — no row is visible to the update at
    // all, which is the policy refusing rather than the trigger. Both callers
    // are on each other's roster (the read test above proves they can SEE one
    // another), so this is the assertion that says sharing an agency is not
    // owning the row.
    assert.deepEqual(await set(AGENCY_A, '6aac00000000000000000004', 'phone', '555'), []);
    assert.deepEqual(await set(AGENCY_B, '6aac00000000000000000001', 'phone', '555'), []);

    // Their own row, a column D82 does not admit. This one raises, and the
    // message names the column, because a caller told only "denied" tries the
    // next field.
    // Authority, an attestation, the agency label and the record of a decision
    // taken about the person — one of each kind the allowlist leaves out.
    //
    // Each value must DIFFER from the one already stored, and that is asserted
    // rather than assumed. The guard fires on `is distinct from`, so a write of
    // the value the row already holds changes nothing and is correctly not
    // refused -- which would make the case below pass vacuously, or vanish, with
    // nothing in the test saying why. It is not hypothetical: `staff_role` was
    // written as 'nurse' here until that became the column's emitted default,
    // and the assertion went quiet rather than red.
    const refused = { role: 'admin', is_approved: 'true', staff_role: 'office_staff',
      agency_name: 'Somewhere Else', offboarded_at: '2026-01-01T00:00:00Z' };
    for (const [column, value] of Object.entries(refused)) {
      const [{ broker_profile_get: stored }] = await as(AGENCY_A,
        `select * from ${SCHEMA}.broker_profile_get($1, $2)`,
        ['6aac00000000000000000001', column]);
      assert.notEqual(stored, value,
        `${column} already holds ${value}, so this write refuses nothing: pick another value`);
      await assert.rejects(() => set(AGENCY_A, '6aac00000000000000000001', column, value),
        error => error.message.includes(`PENNSYNC_PROFILE_FIELD_NOT_SELF_WRITABLE: ${column}`),
        `${column} must not be self-writable`);
    }

    // And the two commands that have no policy at all are gone rather than
    // narrowed: a person can neither remove themselves from the roster nor add
    // somebody to it.
    assert.deepEqual(await as(AGENCY_A, `select * from ${SCHEMA}.broker_profile_delete($1)`,
      ['6aac00000000000000000001']), []);
    const { rows: remaining } = await db.query(
      `select count(*)::integer as total from ${SCHEMA}."user"`);
    assert.equal(remaining[0].total, 2, 'the delete found no row to remove');

    // Nothing above was the owner bypassing anything: acting as the owner with
    // no identity, `caller_user_id()` is null and the predicate matches nobody.
    await db.exec('begin');
    try {
      await db.exec(`set local role ${OWNER_ROLE}`);
      const { rowCount } = await db.query(`update ${SCHEMA}."user" set "phone" = '999'`);
      assert.equal(rowCount, 0, 'forced RLS binds the owner here too');
    } finally { await db.exec('rollback'); }
  } finally {
    await db.exec(`drop function ${SCHEMA}.broker_profile_set(text, text, text);
      drop function ${SCHEMA}.broker_profile_delete(text);
      delete from ${SCHEMA}."user";`);
  }
});

test('forced row level security binds the owner itself, which is the whole point of the role', async () => {
  // Acting as the owner with no request claims: the gate finds no identity, so
  // the predicate matches nothing. An owner that bypassed RLS would see both
  // rows here, and this assertion is what tells the two apart.
  await db.exec('begin');
  try {
    await db.exec(`set local role ${OWNER_ROLE}`);
    const { rows } = await db.query(`select "id" from ${SCHEMA}.supply_item`);
    assert.deepEqual(rows, [], 'the owner must be filtered by its own policies');
  } finally { await db.exec('rollback'); }
});

test('a broker owned by that role serves a caller who holds nothing', async () => {
  // The caller has no privilege on supply_item and cannot execute a helper;
  // everything it gets, it gets through the broker.
  assert.deepEqual(await as(AGENCY_A, `select * from ${SCHEMA}.broker_supply()`), [{ id: 'supply-a' }]);
  assert.deepEqual(await as(AGENCY_B, `select * from ${SCHEMA}.broker_supply()`), [{ id: 'supply-b' }]);

  // Reaching the table directly is refused for want of a grant, so the broker
  // is the only door rather than the convenient one.
  await assert.rejects(() => as(AGENCY_A, `select "id" from ${SCHEMA}.supply_item`),
    /permission denied/i, 'a caller must not reach a record table directly');
  await assert.rejects(() => as(AGENCY_A, `select ${SCHEMA}.caller_agencies()`),
    /permission denied/i, 'a caller must not be able to ask the store who it is');
});

test('the broker changes the acting user without changing the role the gate reads', async () => {
  // This is why the composition works at all. SECURITY DEFINER moves
  // `current_user` to the owner, so the policies bind and the helpers are
  // callable — while `role` still reads `authenticated`, which is what
  // `pennsync_private.actor()` requires before it will name an identity. Had
  // SECURITY DEFINER also moved `role`, the caller gate would refuse every
  // brokered call and the store would be unreachable by design.
  const [session] = await as(AGENCY_A, `select * from ${SCHEMA}.broker_session()`);
  assert.equal(session.who, OWNER_ROLE);
  assert.equal(session.role_setting, 'authenticated');
});

test('the policies still deny through the broker rather than being bypassed by it', async () => {
  // A broker is not an exemption: the same write refused directly is refused here.
  await assert.rejects(() => as(AGENCY_A, `select ${SCHEMA}.broker_add('supply-c', 'agency-b')`),
    /row-level security/i, 'a broker must not be able to write into another agency');
  assert.deepEqual(await as(AGENCY_A, `select ${SCHEMA}.broker_add('supply-d', 'agency-a') as id`),
    [{ id: 'supply-d' }], 'and must still serve the caller own agency');
});

test('it applies as the administrator a real deployment uses, not only as a superuser', async () => {
  // The shape that broke CI. A superuser may SET ROLE to anything, so every
  // test above would pass against a migration that no real deployment can
  // apply. Supabase's migration role is BYPASSRLS and CREATEROLE but NOT a
  // superuser — and since PostgreSQL 16 such a role, on creating another role,
  // receives ADMIN OPTION but neither INHERIT nor SET. Creating the owner is
  // therefore not enough to create a schema owned by it: `create schema …
  // authorization` refuses with "must be able to SET ROLE".
  const other = new PGlite();
  try {
    await authority(other);
    await other.exec(`create role migration_admin nologin nosuperuser bypassrls createrole;
      grant anon, authenticated, service_role to migration_admin with admin option;
      -- A deployment's migration role owns its database; this one is standing in
      -- for it, so it is given the one database privilege that implies.
      do $$ begin execute format('grant create on database %I to migration_admin',
        current_database()); end $$;`);
    // Act as that role for the whole migration, so the grant it needs is one it
    // has to obtain for itself rather than one the session already held.
    await other.exec('set role migration_admin');
    await other.exec(recordStore());
    await other.exec('reset role');

    const { rows: owner } = await other.query(
      'select rolsuper, rolbypassrls from pg_catalog.pg_roles where rolname = $1', [OWNER_ROLE]);
    assert.deepEqual(owner, [{ rolsuper: false, rolbypassrls: false }]);
    const { rows: tables } = await other.query(`
      select count(*) filter (where r.rolname = $2)::integer as owned, count(*)::integer as total
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
      where n.nspname = $1 and c.relkind = 'r'`, [SCHEMA, OWNER_ROLE]);
    assert.equal(tables[0].owned, tables[0].total, 'the tables must still land under the non-bypass owner');
    assert.ok(tables[0].total > 100);
  } finally { await other.close(); }
});

test('the migration refuses an owner role that would void its policies', async () => {
  const other = new PGlite();
  try {
    await authority(other);
    // The role already exists, carrying the attribute that bypasses RLS. The
    // migration must refuse rather than adopt it and emit policies nothing obeys.
    await other.exec(`create role ${OWNER_ROLE} nologin bypassrls;`);
    await assert.rejects(
      () => other.exec(recordStore()),
      /PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS/);
    // The raise aborted the migration's transaction; leave it before asking
    // what survived, or the answer is only that the transaction is aborted.
    await other.exec('rollback');
    const { rows } = await other.query(
      'select count(*)::integer as count from information_schema.schemata where schema_name = $1', [SCHEMA]);
    assert.equal(rows[0].count, 0, 'a refused migration must leave no partial store behind');
  } finally { await other.close(); }
});

test('the migration refuses a database with no authority store to ask', async () => {
  const bare = new PGlite();
  try {
    // The policies are written entirely in terms of `pennsync_private`. Applied
    // without it, every one of them would fail at query time rather than here.
    await assert.rejects(
      () => bare.exec(recordStore()),
      /PENNSYNC_AUTHORITY_STORE_REQUIRED/);
  } finally { await bare.close(); }
});
