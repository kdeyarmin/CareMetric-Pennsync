import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, buildPlan, planEntity, renderDdl } from '../../../tools-entity-schema-plan.mjs';

/**
 * The candidate entity schema has to be real SQL, not a plausible-looking
 * string. This applies the whole generated plan to a fresh PostgreSQL and
 * checks the properties the migration depends on: it parses, every table
 * forces row level security with no policy and no grant, the composite key
 * keeps the two source apps apart, and the generated CHECK constraints
 * actually reject a retired value.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
let db; let plan;

before(async () => {
  const rendered = renderDdl(repository);
  plan = rendered.plan;
  db = new PGlite();
  // The policies ask the authority store who the caller is, so the record
  // schema is applied on top of a real one rather than into an empty database.
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  // One statement batch: a syntax error anywhere fails the whole plan.
  await db.exec(rendered.sql);
});
after(async () => db?.close());

test('the entire generated schema applies to a real PostgreSQL', async () => {
  const { rows } = await db.query(
    'select count(*)::integer as count from information_schema.tables where table_schema = $1', [SCHEMA]);
  assert.equal(rows[0].count, plan.totals.carried);
  assert.ok(plan.totals.carried > 100, 'expected the carried set to be substantial');
});

test('every table forces row level security and carries exactly the policies its decision calls for', async () => {
  const { rows } = await db.query(`
    select c.relname,
           c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::integer as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind = 'r'`, [SCHEMA]);
  assert.equal(rows.length, plan.totals.carried);
  assert.deepEqual(rows.filter(row => !row.enabled || !row.forced), [], 'every carried table must force RLS');

  // Three shapes, and every one of them refuses by ABSENCE rather than by a
  // predicate that evaluates false — forced RLS with nothing to permit an
  // operation is what denies it:
  //
  // - `global`, a platform reference table every agency reads and no tenant
  //   surface writes. One policy, and D83 is why it stays one: a `global` row
  //   is written by migration, never at runtime.
  // - `roster`, which is `User`. Two: the read D23 decided, and the self-update
  //   D82 decided. NOT four — there is no insert and no delete, because a
  //   profile row is enrolment's to create and nobody's to remove, and no
  //   cross-user write, because the update policy names `caller_user_id()`
  //   rather than the roster. The column half of D82 is a trigger and is
  //   checked in `record-tenant-isolation.test.mjs`, since a policy cannot see
  //   `old`.
  // - An entity whose own schema calls the ROW immutable or append-only gets a
  //   read and an insert and NO update or delete, so a rewrite is refused from
  //   everyone including the record owner. Two policies.
  // - Everything else gets read, insert, update and delete.
  //
  // A count outside that set is a table silently denying or silently
  // permitting.
  const byTable = new Map(rows.map(row => [row.relname, row.policies]));
  const expected = entity => (entity.tenant_decision === 'global' ? 1
    : entity.tenant_decision === 'roster' ? 2
      : entity.append_only ? 2 : 4);
  for (const entity of plan.entities) {
    assert.equal(byTable.get(entity.table), expected(entity),
      `${entity.entity} (${entity.tenant_decision ?? 'derived'}) has the wrong number of policies`);
  }
  // The four that say so, named: a fifth would be a claim somebody added
  // without deciding, and the generator refuses that outright.
  assert.deepEqual(plan.entities.filter(entity => entity.append_only).map(entity => entity.entity),
    ['ContentScopeBinding', 'DocumentTenantBinding', 'FleetServiceReview',
      'PatientNoteHistoryEntry']);
  // And the absence is real rather than a permissive policy nobody reads: the
  // two commands that are gone are gone, not narrowed.
  const { rows: appendOnly } = await db.query(`
    select c.relname, p.polcmd from pg_policy p
    join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = any($2) order by c.relname, p.polcmd`,
  [SCHEMA, plan.entities.filter(entity => entity.append_only).map(entity => entity.table)]);
  assert.deepEqual([...new Set(appendOnly.map(row => row.polcmd))].sort(), ['a', 'r'],
    'an append-only table carries select and insert policies and nothing else');
  const roster = plan.entities.filter(entity => entity.tenant_decision === 'roster');
  assert.deepEqual(roster.map(entity => entity.entity), ['User'], 'User is the one roster table');
  // And neither of its policies reads the row's own tenant columns: the ones
  // the subject can rewrite are not narrowed here, they are not consulted. The
  // read asks the authority store who the caller shares an agency with (D23);
  // the update asks who the caller IS (D82). Nothing else is emitted — no
  // insert and no delete — so a person can neither create nor remove a profile
  // row, and no policy admits a write to somebody else's.
  const { rows: predicate } = await db.query(`
    select pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expr, p.polcmd
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = 'user' order by p.polcmd`, [SCHEMA]);
  assert.deepEqual(predicate.map(row => row.polcmd), ['r', 'w'], 'select and update, nothing else');
  const [read, update] = predicate;
  assert.match(read.using_expr, /caller_roster_ids/);
  assert.equal(read.check_expr, null);
  // `with check` as well as `using`, so a row cannot be updated OUT of the
  // caller's ownership any more than into it.
  assert.match(update.using_expr, /caller_user_id/);
  assert.match(update.check_expr, /caller_user_id/);
  assert.ok(!update.using_expr.includes('caller_roster_ids'),
    'the update must name the caller, not the roster: sharing an agency is not owning the row');
  for (const column of ['agency_id', 'agency_name', 'account_type', 'role']) {
    for (const expression of [read.using_expr, update.using_expr, update.check_expr]) {
      assert.ok(!expression.includes(column),
        `no user policy may read ${column}, which the subject can rewrite`);
    }
  }
});

test('a table every agency reads carries no account identifier', async () => {
  // `created_by` is a platform column added to every other table. On a global
  // table it would hand each agency an identifier from whichever agency
  // authored the row, so it is not emitted there.
  const globals = plan.entities.filter(entity => entity.tenant_decision === 'global');
  assert.equal(globals.length, 8);
  const { rows } = await db.query(`select c.relname, a.attname from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and a.attnum > 0 and not a.attisdropped
      and c.relname = any($2) and a.attname = 'created_by'`, [SCHEMA, globals.map(entity => entity.table)]);
  assert.deepEqual(rows, [], 'no global table may carry created_by');
});

test('no table grants direct access to an ordinary role', async () => {
  await db.exec('create role pennsync_reader nologin');
  const { rows } = await db.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind = 'r'
      and has_table_privilege('pennsync_reader', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`, [SCHEMA]);
  assert.deepEqual(rows.map(row => row.relname), []);
});

test('the composite key keeps the two source apps apart', async () => {
  const patient = plan.entities.find(entity => entity.entity === 'Patient');
  assert.ok(patient, 'Patient must be carried');
  const table = `"${SCHEMA}"."${patient.table}"`;
  await db.exec('begin');
  try {
    // Zero id overlap was the finding that made one shared namespace unsafe;
    // the same id under two sources must remain two rows.
    await db.query(`insert into ${table} ("source_app_id","id") values ($1,$2)`, ['694ec16e72e01b60d22f7cbf', 'shared-id']);
    await db.query(`insert into ${table} ("source_app_id","id") values ($1,$2)`, ['68ee80d98929370f9e8f2932', 'shared-id']);
    const { rows } = await db.query(`select count(*)::integer as count from ${table} where "id" = $1`, ['shared-id']);
    assert.equal(rows[0].count, 2);
    await assert.rejects(
      db.query(`insert into ${table} ("source_app_id","id") values ($1,$2)`, ['694ec16e72e01b60d22f7cbf', 'shared-id']),
      error => error.code === '23505');
  } finally { await db.exec('rollback'); }
});

test('a generated enum constraint rejects a retired value and allows an absent one', async () => {
  // Read the column and its permitted values from the plan rather than by
  // parsing SQL: PostgreSQL rewrites `IN (...)` as `= ANY (ARRAY[...])`.
  const patient = planEntity('Patient', readFileSync(resolve(repository, 'base44/entities/Patient.jsonc'), 'utf8'), 'port');
  const check = patient.definition.checks[0];
  assert.ok(check, 'Patient should carry at least one enum constraint');
  const { column, values: [allowed] } = check;
  const table = `"${SCHEMA}"."${patient.table}"`;
  const { rows: applied } = await db.query(`
    select count(*)::integer as count from pg_constraint c
    join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = $1 and t.relname = $2 and c.contype = 'c'`, [SCHEMA, patient.table]);
  assert.equal(applied[0].count, patient.definition.checks.length);
  await db.exec('begin');
  try {
    await db.query(`insert into ${table} ("source_app_id","id","${column}") values ($1,$2,$3)`, ['x', 'ok', allowed]);
    await db.query(`insert into ${table} ("source_app_id","id") values ($1,$2)`, ['x', 'absent']);
    await assert.rejects(
      db.query(`insert into ${table} ("source_app_id","id","${column}") values ($1,$2,$3)`, ['x', 'bad', 'a-retired-value']),
      error => error.code === '23514');
  } finally { await db.exec('rollback'); }
});

test('structured properties keep their shape instead of being flattened', async () => {
  const { rows } = await db.query(`
    select count(*)::integer as count from information_schema.columns
    where table_schema = $1 and data_type = 'jsonb'`, [SCHEMA]);
  assert.ok(rows[0].count > 0, 'arrays and nested objects should be stored as jsonb');
  const { rows: system } = await db.query(`
    select column_name, data_type from information_schema.columns
    where table_schema = $1 and table_name = $2 and column_name in
      ('source_app_id','id','created_date','updated_date','created_by')
    order by column_name`, [SCHEMA, 'patient']);
  assert.deepEqual(system.map(row => row.column_name),
    ['created_by', 'created_date', 'id', 'source_app_id', 'updated_date']);
});

test('an entity that also declares a platform column keeps exactly one of it', async () => {
  // These six document created_by themselves; dropping it would lose the field
  // and duplicating it would not compile.
  for (const entity of ['AlertTriggerRule', 'ClinicalLibraryFolder', 'ClinicalLibraryTemplate',
    'ClinicalPathway', 'FacilityDocumentationRule', 'PatientEducationMaterial']) {
    const carried = plan.entities.find(candidate => candidate.entity === entity);
    assert.ok(carried, `${entity} must be carried`);
    assert.equal(carried.merged_system_columns, 1, `${entity} should merge one platform column`);
    const { rows } = await db.query(`
      select count(*)::integer as count from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = 'created_by'`, [SCHEMA, carried.table]);
    assert.equal(rows[0].count, 1);
  }
});

test('nothing is dropped: every carried entity keeps every property', () => {
  const rebuilt = buildPlan(repository);
  assert.equal(rebuilt.totals.skipped_properties, 0);
  assert.equal(rebuilt.totals.carried, plan.totals.carried);
});
