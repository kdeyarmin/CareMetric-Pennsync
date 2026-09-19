import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('every table forces row level security and carries no policy', async () => {
  const { rows } = await db.query(`
    select c.relname,
           c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::integer as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind = 'r'`, [SCHEMA]);
  assert.equal(rows.length, plan.totals.carried);
  const unprotected = rows.filter(row => !row.enabled || !row.forced || row.policies !== 0);
  assert.deepEqual(unprotected, [], 'every carried table must force RLS with no policy');
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
